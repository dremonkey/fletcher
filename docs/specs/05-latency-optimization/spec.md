# Technical Specification: Latency Optimization

## 1. Overview

Fletcher targets sub-1.5s voice-to-voice (glass-to-glass) latency. The current pipeline is **sequential**: audio is fully transcribed by STT before the LLM begins inference, and the LLM must produce tokens before TTS begins synthesis. Each stage waits for the previous one to complete.

This spec defines three optimization phases that overlap pipeline stages to reduce end-to-end latency. The primary technique is **speculative prefetching** — starting the next pipeline stage before the current one finishes, then discarding wasted work if the input changes.

### Current Latency Budget

```
Stage              Current (ms)    Target (ms)
─────────────────  ──────────────  ──────────────
Audio capture        50–100          50–100
STT (Deepgram)      200–400         200–400   (unchanged — external)
Endpointing delay   500–600         100–300   ← Phase 1
LLM first token     300–600         300–600   (unchanged — external)
LLM↔STT overlap       0            −200–400  ← Phase 2
TTS TTFB            100–200         100–200   (unchanged — external)
──────────────────────────────────────────────
Total              1150–1900        550–1200
```

The biggest wins come from:
1. **Reducing endpointing delay** (Phase 1) — 200–400ms
2. **Overlapping STT and LLM** (Phase 2) — 200–400ms
3. **Pre-warming TTS** (Phase 3) — 50–100ms

---

## 2. Architecture Context

### Current Pipeline (Sequential)

```
User speaks ──→ [VAD detects silence] ──→ [Endpointing delay] ──→ [Final transcript]
                                                                        │
         ┌──────────────────────────────────────────────────────────────┘
         ▼
   [LLM chat()] ──→ [Token stream] ──→ [TTS synthesize] ──→ Agent speaks
```

### Target Pipeline (Overlapped)

```
User speaks ──→ [Interim transcripts flow to LLM speculatively]
                        │
         ┌──────────────┤
         ▼              ▼
   [Speculative LLM]  [VAD END_OF_SPEECH + short delay]
         │              │
         ▼              ▼
   [Reuse if match] ←── [Final transcript]
         │
         ▼
   [Token stream] ──→ [TTS synthesize] ──→ Agent speaks
```

### SDK Capabilities (Already Available)

The `@livekit/agents` SDK v1.0.43 includes infrastructure we can leverage:

| Feature | SDK Support | Status |
|---------|-------------|--------|
| `preemptiveGeneration` option | `VoiceOptions.preemptiveGeneration` | Defaults to `false` |
| Interim transcripts | `UserInputTranscribed` events with `isFinal: false` | Emitted but unused |
| Adaptive endpointing | `minEndpointingDelay` / `maxEndpointingDelay` | Defaults 500ms / 6000ms |
| Custom turn detector | `TurnDetectionMode = _TurnDetector` | Interface exists |
| VAD-based interruption | `allowInterruptions` + `minInterruptionDuration` | Works |

---

## 3. Phase 1: Tuned Endpointing + Preemptive Generation

**Estimated savings: 200–400ms**

### 3.1 Enable Preemptive Generation

The SDK's `AgentSession` already supports speculative LLM inference on high-confidence interim transcripts. When enabled:

1. Interim transcript arrives with high confidence
2. SDK fires `onPreemptiveGeneration()` internally
3. Background LLM `chat()` call starts with current interim text
4. When final transcript arrives:
   - **Match**: Reuse the in-flight generation (saves full LLM TTFT)
   - **Mismatch**: Discard and start fresh (no penalty beyond wasted compute)

**Implementation:**

```typescript
// In VoiceAgent.startSession()
this.session = new voice.AgentSession({
  stt: this.sttInstance ?? undefined,
  tts: this.ttsInstance ?? undefined,
  llm: this.llmInstance ?? undefined,
  voiceOptions: {
    preemptiveGeneration: true,
    minEndpointingDelay: 200,   // Was 500ms
    maxEndpointingDelay: 1500,  // Was 6000ms
  },
});
```

**Files to modify:**
- `packages/openclaw-channel-livekit/src/livekit/audio.ts` — pass `voiceOptions` to `AgentSession`
- `packages/openclaw-channel-livekit/src/types.ts` — add `VoiceOptions` to `ResolvedLivekitAccount`

### 3.2 Tune Endpointing Delays

The default 500ms `minEndpointingDelay` adds a half-second pause after every utterance. For conversational voice, 200ms is sufficient — Deepgram's `speech_final` flag already indicates end-of-utterance.

| Parameter | Default | Proposed | Effect |
|-----------|---------|----------|--------|
| `minEndpointingDelay` | 500ms | 200ms | Faster response after user stops |
| `maxEndpointingDelay` | 6000ms | 1500ms | Cap on ambiguous pauses |
| `minInterruptionDuration` | 500ms | 300ms | Faster interruption detection |

### 3.3 Risks

- **200ms endpointing** may cause the agent to "jump in" during natural pauses mid-sentence. Mitigation: tune per-deployment or make configurable per account.
- **Preemptive generation** wastes LLM compute on discarded predictions. Mitigation: the SDK already handles cancellation; monitor the discard rate.

---

## 4. Phase 2: Streaming Interim Transcripts to LLM

**Estimated savings: 200–400ms**

This is the highest-impact optimization but requires changes to Ganglia's LLM interface. The idea: instead of waiting for a final transcript, start feeding interim transcripts to the LLM and let it begin reasoning while the user is still speaking.

### 4.1 Approach: Provisional Context Injection

Extend Ganglia's `chat()` to accept an optional signal that the last user message is provisional (may be revised). The LLM starts generating based on the interim transcript. If the final transcript differs, generation is cancelled and restarted.

This approach works **within** the existing `llm.LLM` interface — no SDK fork needed.

```typescript
// Extended chat options for Ganglia
interface GangliaChatOptions {
  chatCtx: ChatContext;
  toolCtx?: ToolContext;
  // New: marks the last user message as provisional
  provisional?: boolean;
  // New: abort signal to cancel in-flight generation
  abortSignal?: AbortSignal;
}
```

### 4.2 Custom Agent Node Override

The `voice.Agent` class supports overriding pipeline nodes. We override `transcriptionNode` to forward interim transcripts and `llmNode` to handle provisional context:

```typescript
class SpeculativeAgent extends voice.Agent {
  private pendingAbort: AbortController | null = null;

  // Override: forward interim transcripts to LLM early
  async transcriptionNode(
    text: ReadableStream<string | TimedString>,
    modelSettings: ModelSettings,
  ): Promise<ReadableStream<string | TimedString> | null> {
    // Tap into the transcript stream
    const [forDisplay, forSpeculation] = text.tee();

    // Fire-and-forget: start speculative LLM inference on interim text
    this.speculateFromStream(forSpeculation);

    return forDisplay;
  }

  private async speculateFromStream(
    stream: ReadableStream<string | TimedString>,
  ) {
    // Read interim chunks, update provisional context,
    // trigger speculative chat() calls via Ganglia
  }
}
```

### 4.3 Ganglia Changes

**OpenClawLLM / NanoclawLLM:**
- Accept `provisional: boolean` in extra kwargs
- Pass `AbortSignal` to the HTTP fetch so in-flight requests can be cancelled
- No backend (OpenClaw/Nanoclaw) changes needed — cancellation happens at the HTTP layer

**New method on GangliaLLM:**
```typescript
interface GangliaLLM extends llm.LLM {
  // Existing
  gangliaType(): string;
  setDefaultSession?(session: GangliaSessionInfo): void;

  // New: cancel in-flight generation
  cancelPending?(): void;
}
```

### 4.4 Sequence Diagram

```
User speaking:    |---"What is"---|---"the weather"---|---"in Paris"---| (silence)
                                  |                   |                |
Interim→LLM:                      → chat("What is")   → cancel
                                                      → chat("What is the weather") → cancel
                                                                      → chat("What is the weather in Paris")
                                                                                      |
Final transcript: ─────────────────────────────────────────────────────→ "What is the weather in Paris"
                                                                                      |
LLM generation:                                                        ───────────────→ (already in progress!)
                                                                                         │
TTS:                                                                                     → first audio chunk
```

### 4.5 Design Decisions

**Why not bidirectional gRPC streaming?**
- Adds protocol complexity (proto files, codegen, debugging)
- OpenClaw/Nanoclaw expose OpenAI-compatible HTTP APIs
- HTTP request cancellation (`AbortController`) achieves the same effect
- Savings from protocol change alone (~5-15ms) are negligible vs. the overlap savings

**Why not modify the SDK?**
- The `voice.Agent` node override pattern is the intended extension point
- Avoids maintaining a fork of `@livekit/agents`
- Stays compatible with SDK updates

**Discard strategy:**
- Only the last speculative generation is kept active
- On each new interim transcript: cancel previous, start new
- Debounce: wait 100ms of stable text before triggering a new speculative call
- This limits wasted LLM calls to ~2-3 per utterance

### 4.6 Risks

- **Cost**: Speculative calls that get discarded waste LLM tokens. For a 10-word utterance with 3 speculative calls, this is roughly 3x the input tokens. Output tokens are minimal (generation is cancelled early).
- **Correctness**: The LLM sees a partial sentence and may generate a nonsensical response. Mitigation: the response is only used if the final transcript matches; otherwise it's discarded.
- **Race conditions**: Careful ordering of cancel/start operations. The `AbortController` pattern handles this cleanly.

---

## 5. Phase 3: TTS Pre-warming

**Estimated savings: 50–100ms**

### 5.1 Persistent TTS Connection

Cartesia supports WebSocket-based streaming synthesis. Keep the WebSocket open between utterances to eliminate connection setup time.

The `@livekit/agents-plugin-cartesia` already manages connection pooling internally. Verify via configuration:

```typescript
this.ttsInstance = new cartesia.TTS({
  // ... existing config
  chunkTimeout: 5000, // Keep connection alive between utterances
});
```

### 5.2 Sentence Boundary Streaming

The SDK already streams LLM tokens to TTS as they arrive. Verify that the `ttsNode` is configured to start synthesis on the first sentence boundary (period, question mark) rather than waiting for the complete response.

This is the default behavior in `@livekit/agents` — no changes needed, but worth validating with timing instrumentation.

---

## 6. Instrumentation & Measurement

All optimizations must be measured. Add latency telemetry to the VoiceAgent.

### 6.1 Timing Points

```typescript
interface LatencyMetrics {
  // Per-turn timestamps (ms since epoch)
  userSpeechEnd: number;      // VAD END_OF_SPEECH
  sttFinalTranscript: number; // Final transcript received
  llmFirstToken: number;      // First LLM token
  ttsFirstByte: number;       // First audio byte from TTS
  agentSpeechStart: number;   // First audio published to room

  // Derived
  endpointingDelay: number;   // sttFinalTranscript - userSpeechEnd
  llmTTFT: number;            // llmFirstToken - sttFinalTranscript
  ttsTTFB: number;            // ttsFirstByte - llmFirstToken
  totalLatency: number;       // agentSpeechStart - userSpeechEnd

  // Speculation metrics
  speculativeHit: boolean;    // Did speculative generation match final?
  speculativeSaved: number;   // llmTTFT saved by speculation (ms)
}
```

### 6.2 Event Emission

Publish metrics via the existing `ganglia-events` data channel so the Flutter app can display latency in real time:

```typescript
{
  type: "metrics",
  metrics: {
    totalLatency: 820,
    endpointingDelay: 180,
    llmTTFT: 340,
    ttsTTFB: 120,
    speculativeHit: true,
    speculativeSaved: 280,
  }
}
```

---

## 7. Implementation Order

| Phase | What | Savings | Complexity | Dependencies |
|-------|------|---------|------------|--------------|
| **1** | Enable `preemptiveGeneration`, tune endpointing | 200–400ms | Low | None — SDK config only |
| **1b** | Latency instrumentation | — (measurement) | Low | None |
| **2** | Streaming interim transcripts to LLM | 200–400ms | Medium | Ganglia `cancelPending()`, custom Agent node |
| **3** | TTS pre-warming validation | 50–100ms | Low | None |

Phase 1 is a configuration change and should be done first to establish the baseline improvement. Phase 2 is the highest-impact engineering work. Phase 3 is validation of existing SDK behavior.

---

## 8. Success Criteria

| Metric | Current | Phase 1 Target | Phase 2 Target |
|--------|---------|----------------|----------------|
| Median total latency | ~1400ms | <1100ms | <800ms |
| P95 total latency | ~1900ms | <1500ms | <1200ms |
| Endpointing delay | ~550ms | <250ms | <250ms |
| Speculative hit rate | N/A | >40% | >60% |
| Wasted LLM calls/turn | 0 | <1 | <3 |

---

## 9. References

- `@livekit/agents` v1.0.43 — `agent_activity.ts` lines 767–807 (`onPreemptiveGeneration`)
- `@livekit/agents` v1.0.43 — `audio_recognition.ts` lines 347–505 (endpointing logic)
- `@livekit/agents` v1.0.43 — `agent.d.ts` lines 69–75 (node override pattern)
- `packages/livekit-agent-ganglia/src/llm.ts` — OpenClawLLM chat() implementation
- `packages/livekit-agent-ganglia/src/nanoclaw.ts` — NanoclawLLM chat() implementation
- `packages/openclaw-channel-livekit/src/livekit/audio.ts` — VoiceAgent pipeline entry point

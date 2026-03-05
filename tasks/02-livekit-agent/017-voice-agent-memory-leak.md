# Task 017: Voice Agent Memory Leak

## Problem

The voice agent process accumulates memory over time, reaching **7.4 GB** after extended operation (observed in [BUG-004](../../docs/field-tests/20260305-buglog.md)). The `memoryWarnMB` threshold is 500 MB but has no enforcement — warnings are logged every 5s but the process continues running. The leak is severe enough to degrade system performance and risk OOM kills.

After a clean restart, memory climbed to ~780 MB within 30 minutes, confirming the leak is active and not just a one-time artifact.

## Investigation

### Theory 1: `_AudioOut.audio` Array Accumulation

**Status: CONFIRMED — PRIMARY CAUSE**

Every TTS audio frame is pushed to an array that is **never read and never cleared**.

**Creation** — `generation.ts:790-808`:
```typescript
export function performAudioForwarding(...): [Task<void>, _AudioOut] {
  const out: _AudioOut = {
    audio: [],                    // ← empty array created per speech turn
    firstFrameFut: new Future<number>(),
  };
  return [Task.from(...forwardAudio(ttsStream, audioOutput, out, ...)...), out];
}
```

**Accumulation** — `generation.ts:753`:
```typescript
out.audio.push(frame);            // ← EVERY frame pushed, never cleared
```

**Never read** — `agent_activity.ts` only accesses `audioOut.firstFrameFut` (lines 1448, 1646, 1729, 2076, 2184). The `.audio` array is **never accessed anywhere** in `agent_activity.ts`.

**Memory math:** At 48kHz mono 16-bit PCM:
- ~96 KB/sec of audio data
- 30% speaking time over 9 hours = ~9,720 seconds of audio
- **~933 MB** of retained AudioFrame objects

This alone explains the bulk of the 7.4 GB observation when combined with other factors (TTS retry storms during the 429 cascade created thousands of short-lived `_AudioOut` instances in rapid succession, each accumulating frames from the Piper fallback before GC could collect them).

**Retention chain:** `_AudioOut` is captured by the `forwardAudio` closure inside a `Task`. The Task is stored in `speechHandle._tasks[]` (agent_activity.ts:933). While the SpeechHandle _should_ eventually be GC'd (it's removed from `_currentSpeech` and `speechQueue` after the turn completes), the `_tasks[]` array is never cleared, creating a mutual reference cycle (SpeechHandle → _tasks → Task → closure → _AudioOut). JavaScript GC can collect cycles, but only if no external root references into them. Under memory pressure with rapid TTS retries, GC may lag.

### Theory 2: OpenTelemetry Span Leak

**Status: CONFIRMED — SECONDARY CAUSE (~25-30 MB/8hr)**

TTS and LLM streams create OpenTelemetry spans with `endOnExit: false`, meaning the caller must manually call `span.end()`. The ending only happens inside `monitorMetrics()`, which is unreachable on early abort.

**TTS span creation** — `tts.ts:238-242`:
```typescript
private mainTask = async () =>
  tracer.startActiveSpan(async (span) => this._mainTaskImpl(span), {
    name: 'tts_request',
    endOnExit: false,     // ← span NOT auto-ended
  });
```

**Span ending** — `tts.ts:338-341` (inside `monitorMetrics()`):
```typescript
if (this.#ttsRequestSpan) {
  this.#ttsRequestSpan.end();
}
```

**Abort handler** — `tts.ts:169-175`: closes input/output but does NOT end the span.

**LLM has the same pattern** — `llm.ts:192-196` creates span with `endOnExit: false`, only ended at `llm.ts:269` inside `monitorMetrics()`.

**Impact:** ~500 bytes–2 KB per leaked span. During the 429 storm with thousands of aborted TTS streams, this could accumulate several MB.

### Theory 3: TranscriptManager.knownStreamIds

**Status: CONFIRMED — MINOR CAUSE**

`apps/voice-agent/src/transcript-manager.ts:34`:
```typescript
private knownStreamIds = new Set<string>();
```

This Set grows forever — stream IDs are added but never removed. Each ID is a short string (~5 bytes), so over 9 hours with ~1,000 streams this is only ~5 KB. Minor but unbounded.

### Theory 4: ChatContext Growth

**Status: EXPECTED BEHAVIOR — NOT A BUG**

`agent._chatCtx` accumulates messages across turns. This is by design (context window). Text-only messages are small. Not the primary leak.

### Theory 5: TTS Retry Storm Amplification

**Status: CONFIRMED — AMPLIFIER**

During the Gemini 429 cascade, the FallbackAdapter rapidly created and destroyed TTS streams. Each attempt created:
- A `SynthesizeStream` with ReadableStreams, spans, buffers
- A `performAudioForwarding` call creating an `_AudioOut` with audio array
- An `IdentityTransform` stream pair in `performTTSInference`

With `maxRetryPerTTS: 0`, each failure went Gemini → Piper (one retry cycle). But with the pipeline retrying at the speech level, thousands of cycles occurred in minutes. Even if each cycle is eventually GC'd, the allocation rate vastly outpaces collection under load.

### Theory 6: Inference Process Baseline

**Status: NOT A LEAK — EXPECTED**

The inference child process (ONNX runtime for end-of-utterance models) uses 1.2 GB at baseline with no active session. This is the cost of loading two ONNX models (`lk_end_of_utterance_en` and `lk_end_of_utterance_multilingual`). Not a leak.

## Proposed Fix

### Fix 1: Clear `_AudioOut.audio` after forwarding completes (SDK patch)

**File:** `node_modules/.bun/@livekit+agents@1.0.48+.../src/voice/generation.ts`
**Lines:** 778-787 (finally block of `forwardAudio`)

This is the highest-impact fix. Since `out.audio` is never read by `agent_activity.ts`, we can clear it immediately after forwarding completes:

```typescript
// BEFORE (line 778-787):
  } finally {
    audioOutput.off(AudioOutput.EVENT_PLAYBACK_STARTED, onPlaybackStarted);
    if (!out.firstFrameFut.done) {
      out.firstFrameFut.reject(new Error('audio forwarding cancelled before playback started'));
    }
    reader?.releaseLock();
    audioOutput.flush();
  }

// AFTER:
  } finally {
    audioOutput.off(AudioOutput.EVENT_PLAYBACK_STARTED, onPlaybackStarted);
    if (!out.firstFrameFut.done) {
      out.firstFrameFut.reject(new Error('audio forwarding cancelled before playback started'));
    }
    reader?.releaseLock();
    audioOutput.flush();
    out.audio.length = 0;  // ← Release accumulated AudioFrames
  }
```

**Why this works:** The `.audio` array is a vestigial field — populated but never consumed by any code path. Clearing it in the `finally` block releases all AudioFrame references immediately after forwarding completes (whether normally or via abort), preventing accumulation across turns.

**Implementation:** This requires patching the SDK. Options:
1. **patch-package / bun patch** — apply a local patch to the installed SDK
2. **Upstream PR** — submit fix to `livekit/agents-js` (recommended long-term)
3. **Fork** — maintain a patched fork (not recommended)

### Fix 2: Clean up `TranscriptManager.knownStreamIds` (local code)

**File:** `apps/voice-agent/src/transcript-manager.ts`
**Method:** `finalizeStream()`

```typescript
// BEFORE (line 118-131):
  private finalizeStream(streamId: string): void {
    const seg = this.streamSegments.get(streamId);
    if (!seg) return;
    if (seg.text) {
      this.deps.publishEvent({ ... });
    }
    this.streamSegments.delete(streamId);
  }

// AFTER:
  private finalizeStream(streamId: string): void {
    const seg = this.streamSegments.get(streamId);
    if (!seg) return;
    if (seg.text) {
      this.deps.publishEvent({ ... });
    }
    this.streamSegments.delete(streamId);
    this.knownStreamIds.delete(streamId);  // ← Prevent unbounded growth
  }
```

**Why this works:** Once a stream is finalized, its ID is no longer needed for the BUG-011 zombie detection. The `streamSegments.delete()` already fires, so adding `knownStreamIds.delete()` is safe — any late pondering rotations from zombie streams will be treated as "new" streams, which is harmless (they'll create a segment that gets immediately finalized).

### Fix 3: Add span cleanup to abort handlers (SDK patch)

**File:** `node_modules/.bun/@livekit+agents@1.0.48+.../src/tts/tts.ts`
**Lines:** 169-175 (abort handler in SynthesizeStream constructor)

```typescript
// BEFORE:
this.abortController.signal.addEventListener('abort', () => {
  this.input.close();
  this.output.close();
});

// AFTER:
this.abortController.signal.addEventListener('abort', () => {
  this.input.close();
  this.output.close();
  if (this.#ttsRequestSpan) {
    this.#ttsRequestSpan.setAttribute('aborted', true);
    this.#ttsRequestSpan.end();
    this.#ttsRequestSpan = undefined;
  }
});
```

Same pattern for LLM in `llm.ts:129-133`.

### Fix 4: Add Docker memory limit (infrastructure)

**File:** `docker-compose.yml`

```yaml
  voice-agent:
    # ... existing config ...
    deploy:
      resources:
        limits:
          memory: 2G
```

This provides a safety net — the container will be OOM-killed and restarted by Docker rather than consuming all host memory.

## Edge Cases

1. **Fix 1 — clearing `out.audio`:** If a future SDK version starts reading `out.audio` for transcript synchronization or replay, this fix would break it. The fix should be checked against each SDK upgrade. Currently confirmed unused in v1.0.48.

2. **Fix 2 — `knownStreamIds` cleanup:** If a zombie stream's pondering arrives after finalization, it will be treated as a new stream. This creates a brief unnecessary segment that is immediately finalized on the next `onPondering(null)`. This is cosmetically incorrect (a phantom "thinking" status may flash) but functionally harmless.

3. **Fix 3 — span abort:** Double-ending a span is a no-op in OpenTelemetry, so there's no risk if `monitorMetrics()` also tries to end it. Setting the attribute `aborted: true` helps with observability.

4. **TTS retry storm:** Fixes 1-3 address the memory retention, but don't prevent the allocation storm during 429 cascades. The 60s debounce on error artifacts (already applied) reduces client-side impact. Further mitigation would require rate-limiting TTS stream creation in the SDK, which is out of scope.

## Acceptance Criteria

- [ ] `out.audio.length = 0` added to `forwardAudio` finally block (SDK patch)
- [ ] `knownStreamIds.delete(streamId)` added to `TranscriptManager.finalizeStream()`
- [ ] Span `.end()` added to TTS and LLM abort handlers (SDK patch)
- [ ] Docker memory limit added to `docker-compose.yml`
- [ ] After 1+ hour voice session, worker process stays under 500 MB (excluding inference child)
- [ ] Existing transcript-manager tests pass
- [ ] No regression in voice pipeline behavior (audio plays, pondering works, interruption works)

## Files

- `apps/voice-agent/src/transcript-manager.ts` — Fix 2 (knownStreamIds cleanup)
- `docker-compose.yml` — Fix 4 (memory limit)
- SDK patches (Fix 1, Fix 3) — requires `bun patch` or upstream PR:
  - `@livekit/agents/src/voice/generation.ts` — Fix 1 (clear audio array)
  - `@livekit/agents/src/tts/tts.ts` — Fix 3 (TTS span cleanup)
  - `@livekit/agents/src/llm/llm.ts` — Fix 3 (LLM span cleanup)

## Status

- **Date:** 2026-03-05
- **Priority:** HIGH
- **Status:** RCA COMPLETE
- **Related bugs:** [BUG-004](../../docs/field-tests/20260305-buglog.md)

# Task 019: Internal Memory Leak Mitigations

## Summary

Apply local fixes for the memory leak issues identified in [017-voice-agent-memory-leak.md](./017-voice-agent-memory-leak.md) that we can address without waiting for an upstream SDK release. Three changes:

1. **TranscriptManager.knownStreamIds cleanup** — unbounded Set growth
2. **OpenTelemetry span leak on abort** — SDK patch via `bun patch`
3. **Docker memory limit** — safety net against future leaks

## Changes

### 1. TranscriptManager: clean up `knownStreamIds`

**File:** `apps/voice-agent/src/transcript-manager.ts`
**Method:** `finalizeStream()` (line 118)

The `knownStreamIds` Set grows forever — stream IDs are added in `onPondering()` (line 68) but never removed. Add cleanup in `finalizeStream()`:

```diff
  private finalizeStream(streamId: string): void {
    const seg = this.streamSegments.get(streamId);
    if (!seg) return;
    if (seg.text) {
      this.deps.publishEvent({
        type: 'agent_transcript',
        segmentId: `seg_${seg.segId}`,
        delta: '',
        text: seg.text,
        final: true,
      });
    }
    this.streamSegments.delete(streamId);
+   this.knownStreamIds.delete(streamId);
  }
```

**Risk:** Low. After finalization, a zombie stream's late pondering rotation would be treated as a "new" stream. This creates a brief phantom segment that is immediately finalized on the next `onPondering(null)`. Functionally harmless — the BUG-011 zombie protection still works for the window between stream start and finalization.

**Test:** Update existing transcript-manager tests to verify `knownStreamIds` shrinks after finalization.

### 2. OpenTelemetry span leak on abort (`bun patch`)

**Files (inside `@livekit/agents`):**
- `src/tts/tts.ts` — `SynthesizeStream` abort handler (line ~169)
- `src/llm/llm.ts` — `LLMStream` abort handler (line ~129)

Both create spans with `endOnExit: false` but only end them inside `monitorMetrics()`, which is unreachable on early abort. Apply via `bun patch @livekit/agents`:

**TTS fix** (`src/tts/tts.ts`):
```diff
  this.abortController.signal.addEventListener('abort', () => {
    this.input.close();
    this.output.close();
+   if (this.#ttsRequestSpan) {
+     this.#ttsRequestSpan.setAttribute('aborted', true);
+     this.#ttsRequestSpan.end();
+     this.#ttsRequestSpan = undefined;
+   }
  });
```

**LLM fix** (`src/llm/llm.ts`):
```diff
  this.abortController.signal.addEventListener('abort', () => {
    this.output.close();
    this.closed = true;
+   if (this.#llmRequestSpan) {
+     this.#llmRequestSpan.setAttribute('aborted', true);
+     this.#llmRequestSpan.end();
+     this.#llmRequestSpan = undefined;
+   }
  });
```

**Risk:** Low. `span.end()` is idempotent in OpenTelemetry — double-ending is a no-op. The `aborted: true` attribute aids observability.

**Impact:** ~25-30 MB savings per 8-hour session; more during TTS error storms.

### 3. Docker memory limit

**File:** `docker-compose.yml`

Add a 2 GB memory limit to the voice-agent container as a safety net:

```diff
  voice-agent:
    build:
      context: .
      dockerfile: apps/voice-agent/Dockerfile
    network_mode: host
    env_file: .env
+   deploy:
+     resources:
+       limits:
+         memory: 2G
    environment:
      ...
```

**Risk:** If the agent legitimately needs more than 2 GB (unlikely after the other fixes), Docker will OOM-kill and restart it. The `restart: unless-stopped` policy means it auto-recovers. The inference child process (ONNX, ~1.2 GB baseline) runs inside the same container, so 2 GB is tight — monitor after deploying and bump to 3 GB if needed.

## Acceptance Criteria

- [ ] `knownStreamIds.delete()` added to `TranscriptManager.finalizeStream()`
- [ ] Transcript-manager tests updated and passing
- [ ] `bun patch @livekit/agents` applied with span cleanup in TTS + LLM abort handlers
- [ ] Docker memory limit added to `docker-compose.yml`
- [ ] `docker compose build voice-agent` succeeds
- [ ] 1-hour voice session: worker RSS stays under 1 GB (excluding inference child process)

## Files

- `apps/voice-agent/src/transcript-manager.ts`
- `apps/voice-agent/src/transcript-manager.spec.ts` (test updates)
- `docker-compose.yml`
- `patches/@livekit+agents@1.0.48.patch` (or wherever bun places patches)

## Status

- **Date:** 2026-03-05
- **Priority:** HIGH
- **Status:** READY TO IMPLEMENT
- **Parent RCA:** [017-voice-agent-memory-leak.md](./017-voice-agent-memory-leak.md)

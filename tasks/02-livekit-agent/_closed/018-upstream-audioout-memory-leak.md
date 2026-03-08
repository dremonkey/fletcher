# Task 018: Upstream `_AudioOut.audio` Memory Leak in `@livekit/agents`

## Summary

File an issue (and eventually a PR) against [`livekit/agents-js`](https://github.com/livekit/agents-js) for a memory leak in the voice pipeline. The `_AudioOut.audio` array in `generation.ts` accumulates every TTS AudioFrame but is **never read** — it grows unboundedly for the lifetime of each speech turn and is only released when the enclosing `SpeechHandle` is garbage-collected.

## Root Cause

**File:** `src/voice/generation.ts` (v1.0.48)

### The accumulation

`performAudioForwarding()` (line 790) creates an `_AudioOut` object with an empty `audio: []` array. The inner `forwardAudio()` function pushes every TTS audio frame to this array (line 753):

```typescript
// generation.ts:720-724
export interface _AudioOut {
  audio: Array<AudioFrame>;       // ← grows unboundedly
  firstFrameFut: Future<number>;
}

// generation.ts:750-753 (inside forwardAudio while loop)
const { done, value: frame } = await reader.read();
if (done) break;
out.audio.push(frame);            // ← every frame pushed
```

### Never consumed

The `_AudioOut` object is used in `agent_activity.ts` at lines 1420/1636/2038, but **only `firstFrameFut` is ever accessed** (lines 1448, 1646, 1729, 2076, 2184). The `.audio` array is never read by any code path.

### Retention chain

The `_AudioOut` object is captured by the `forwardAudio` closure inside a `Task` object. That Task is stored in `speechHandle._tasks[]` (agent_activity.ts:933), which is **never cleared** — not even after `_markDone()` is called (speech_handle.ts:245-252). The AudioFrame data is retained until the entire SpeechHandle is garbage-collected.

### Memory impact

At 48kHz mono 16-bit PCM: ~96 KB/sec of audio data. In a long-running voice session with ~30% agent speaking time:

| Duration | Retained audio |
|----------|---------------|
| 1 hour   | ~104 MB       |
| 4 hours  | ~415 MB       |
| 9 hours  | ~933 MB       |

This is amplified during TTS error recovery — each retry cycle creates a new `performAudioForwarding` call with a fresh `_AudioOut`, and under rapid retry conditions (e.g., TTS 429 rate-limit cascades), thousands of short-lived `_AudioOut` instances can be created faster than GC can collect them.

## How to Reproduce

1. Run a LiveKit voice agent with any TTS provider (e.g., ElevenLabs, Google, Piper)
2. Have a continuous voice conversation for 1+ hours
3. Monitor the worker process RSS memory (the SDK already logs this via `supervised_proc.ts` every 5s when above `memoryWarnMB`)
4. Observe: memory grows linearly with cumulative TTS audio output, never stabilizes

**Faster reproduction:** Use a TTS provider that returns audio quickly (e.g., a local Piper sidecar) and have rapid back-and-forth conversation. Memory should visibly climb within 10-15 minutes.

**Fastest reproduction (retry storm):** Configure a TTS provider that rate-limits aggressively (e.g., Gemini free tier at 10 RPM). Once rate-limited, the pipeline retries rapidly, creating thousands of `_AudioOut` instances in minutes. We observed 7.4 GB in a single session this way.

## Proposed Fix

Clear the audio array in the `finally` block of `forwardAudio()`:

```diff
--- a/src/voice/generation.ts
+++ b/src/voice/generation.ts
@@ -785,6 +785,7 @@ async function forwardAudio(
     reader?.releaseLock();
     audioOutput.flush();
+    out.audio.length = 0;
   }
 }
```

This is safe because `out.audio` is never read by any consumer. The `firstFrameFut` (which IS used) is unaffected.

### Optional additional fix: clear `SpeechHandle._tasks` on done

In `speech_handle.ts`, `_markDone()` could clear the `_tasks` array to break the retention cycle:

```diff
--- a/src/voice/speech_handle.ts
+++ b/src/voice/speech_handle.ts
@@ -249,6 +249,7 @@ export class SpeechHandle {
     if (!this.doneFut.done) {
       this.doneFut.resolve();
+      this._tasks.length = 0;
       if (this.generations.length > 0) {
         this._markGenerationDone();
       }
```

## Checklist

- [ ] Open issue on `livekit/agents-js` with reproduction steps
- [ ] Submit PR with the `out.audio.length = 0` fix
- [ ] Optionally include `_tasks.length = 0` in `_markDone()`
- [ ] Verify fix with 1+ hour voice session (RSS stays stable)

## Status

- **Date:** 2026-03-05
- **Priority:** HIGH
- **Status:** RCA COMPLETE — ready to file upstream
- **Affects:** `@livekit/agents` v1.0.48 (and likely all versions with `_AudioOut`)
- **Parent RCA:** [017-voice-agent-memory-leak.md](./017-voice-agent-memory-leak.md)

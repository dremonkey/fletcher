# TASK-015: Agent-Side Tiered TTS with Local Fallback

Implement a multi-tier TTS strategy on the voice agent to improve resilience when cloud TTS providers error or hit rate limits.

## Context
Field testing shows that cloud TTS failures (ElevenLabs 402, Google 429 rate limits) leave the user without voice for an entire turn or longer. The BUG-024 fix prevents session death by tolerating TTS errors, but the user still gets silence — they only see text via the data channel. A local fallback TTS on the agent server would produce *some* audio rather than none.

The existing `createTTS()` factory in `tts-provider.ts` and the LiveKit `tts.TTS` plugin interface make this straightforward to implement on the agent side.

## Tier Overview

| Tier | Where | Provider | When |
|------|-------|----------|------|
| **Tier 3 (High-Fidelity)** | Agent → Cloud API | ElevenLabs / Google | Default — network healthy, quota available |
| **Tier 2 (Local Fallback)** | Agent → Piper sidecar | Piper (ONNX, Docker) | Cloud TTS errors (429, 402, timeout) |
| **Tier 1 (Instant Text)** | Agent → Data channel | N/A (text only) | Always — immediate visual feedback |

## Objectives

- [x] **Tier 1 (Instant Text):** LLM text responses delivered via `ganglia-events` data channel immediately, bypassing the audio pipeline. *(Already implemented — `onContent` callback.)*
- [x] **Tier 3 (High-Fidelity):** Cloud-streamed TTS as the primary path. *(Already implemented — ElevenLabs/Google via `createTTS()`.)*
- [x] **Error Tolerance:** TTS failures don't kill the session. *(Already implemented — BUG-024 fix, `maxUnrecoverableErrors: Infinity`.)*
- [x] **Piper Sidecar:** Add a Piper TTS container to `docker-compose.yml` using `waveoffire/piper-tts-server` image with host networking on port 5000.
- [x] **Tier 2 (Local Fallback):** `PiperTTS` plugin (`piper-tts.ts`) posts text to Piper HTTP sidecar, receives WAV, strips header, yields AudioFrames. 11 unit tests.
- [x] **Fallback TTS Wrapper:** Uses LiveKit SDK's built-in `tts.FallbackAdapter` instead of a custom wrapper — handles priority-based failover, background recovery, and audio resampling.
- [x] **Switching Logic:** `FallbackAdapter` with `maxRetryPerTTS: 0` — any TTS error immediately falls through to Piper. FallbackAdapter handles background recovery to retry cloud provider on subsequent turns.
- [x] **UX Feedback:** Send a `ganglia-events` artifact to the client indicating degraded voice quality when fallback is active (mirrors existing "Voice Unavailable" pattern from BUG-024). Three tiers: "Voice Degraded" (fallback active), "Voice Restored" (primary recovered), "Voice Unavailable" (all TTS failed).

## Technical Approach

### Piper as a Docker Sidecar
- [Piper](https://github.com/rhasspy/piper) is a fast, lightweight ONNX-based TTS.
- Run as a separate container in `docker-compose.yml` using a purpose-built image — keeps native dependencies (ONNX Runtime, espeak-ng) out of the voice agent image and Nix config entirely.
- The voice agent calls Piper over HTTP on the Docker network (e.g., `http://piper:5000/synthesize`).
- Voice model baked into the image or mounted as a volume.

```yaml
# docker-compose.yml (addition)
piper:
  image: rhasspy/wyoming-piper  # or similar purpose-built image
  ports:
    - "5000:5000"
  volumes:
    - ./piper-voices:/data/voices  # optional: mount voice models
```

### PiperTTS Plugin
- Thin `PiperTTS` class implementing `tts.TTS` that calls the sidecar's HTTP API.
- Accepts text, returns PCM/WAV audio frames compatible with the LiveKit audio pipeline.
- No native deps in the voice agent — just an HTTP client call.

### FallbackTTS Wrapper
```
createTTS(provider, logger)
  └─> FallbackTTS
        ├── primary: ElevenLabs / Google (cloud)
        └── fallback: PiperTTS (HTTP → sidecar)
```
- On `synthesize()` or `stream()` call, try the primary provider first.
- If the primary throws (rate limit, auth error, timeout), catch and re-synthesize with the fallback.
- Log the fallback activation and send a client-facing artifact event.

### Integration Points
- `docker-compose.yml` — add Piper sidecar service.
- `apps/voice-agent/src/piper-tts.ts` — new `PiperTTS` class (HTTP client → sidecar).
- `apps/voice-agent/src/fallback-tts.ts` — new `FallbackTTS` wrapper class.
- `apps/voice-agent/src/tts-provider.ts` — extend `createTTS()` to return `FallbackTTS` wrapping the cloud provider + `PiperTTS`.
- `apps/voice-agent/src/agent.ts` — no changes needed. `AgentSession` receives a `tts.TTS` interface either way.

### Environment Variables
- `PIPER_URL` — Piper sidecar endpoint (default: `http://piper:5000`). Not required — fallback is simply disabled if Piper is unavailable.

## Success Criteria
- When the cloud TTS errors, the user hears a lower-fidelity voice response instead of silence.
- Text transcripts continue to flow regardless of TTS state (already true).
- No "Zombie Agent" states caused by stalled audio streams.
- Fallback activation is visible to the user via a subtle indicator.
- Piper sidecar has zero impact on the voice agent's Docker image, Nix config, or build.

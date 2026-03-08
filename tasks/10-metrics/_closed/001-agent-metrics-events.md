# Task 002a: Wire Up AgentSession Metric Events

**Epic:** 10 - Metrics & Observability
**Parallel:** Yes — no dependencies on other tasks in this epic

## Objective

Hook into `@livekit/agents` built-in `AgentSession` events to capture and log per-turn metrics (LLM TTFT, TTS TTFB, EOU delay, STT duration) via pino structured logging. This gives immediate visibility into latency without any new dependencies.

## Background

The `AgentSession` (from `@livekit/agents`) extends `TypedEmitter` and emits:
- `MetricsCollected` with typed metrics: `LLMMetrics`, `TTSMetrics`, `EOUMetrics`, `STTMetrics`, `VADMetrics`
- `AgentStateChanged` with `oldState` / `newState` (idle → thinking → speaking)
- `UserInputTranscribed` with transcript, isFinal, language

These events fire automatically when the voice pipeline runs. Fletcher currently ignores all of them.

## Checklist

- [x] In `apps/voice-agent/src/agent.ts`, after `session.start()`:
  - [x] Add `session.on(MetricsCollected)` listener that logs each metric type via pino:
    - `LLMMetrics`: `ttftMs`, `durationMs`, `tokensPerSecond`, `completionTokens`, `cancelled`, `speechId`
    - `TTSMetrics`: `ttfbMs`, `durationMs`, `audioDurationMs`, `cancelled`, `speechId`
    - `EOUMetrics`: `endOfUtteranceDelayMs`, `transcriptionDelayMs`, `onUserTurnCompletedDelayMs`, `speechId`
    - `STTMetrics`: `durationMs`, `audioDurationMs`, `streamed`
  - [x] Add `session.on(AgentStateChanged)` listener that logs state transitions
  - [x] Add `session.on(UserInputTranscribed)` listener that logs final transcripts
- [x] Verify that `OpenClawChatStream` (extends `LLMStream`) auto-emits `metrics_collected` — if not, emit manually at end of `run()` in `llm.ts`
- [x] Rebuild Docker image and test with phone — confirm metrics appear in `docker compose logs`

## Files

- `apps/voice-agent/src/agent.ts` — add event listeners after line 83 (session.start)
- `packages/livekit-agent-ganglia/src/llm.ts` — verify/fix metrics emission from OpenClawChatStream

## Key Types (from @livekit/agents)

```typescript
import { voice } from '@livekit/agents';
// voice.AgentSessionEventTypes.MetricsCollected
// voice.AgentSessionEventTypes.AgentStateChanged
// voice.AgentSessionEventTypes.UserInputTranscribed
```

## Success Criteria

Docker logs show structured pino output like:
```json
{"level":30,"metric":"llm","ttftMs":8520,"durationMs":12000,"tokensPerSecond":45,"speechId":"speech_abc123","msg":"LLM metrics"}
{"level":30,"metric":"tts","ttfbMs":180,"durationMs":3200,"speechId":"speech_abc123","msg":"TTS metrics"}
{"level":30,"metric":"eou","endOfUtteranceDelayMs":513,"transcriptionDelayMs":200,"speechId":"speech_abc123","msg":"EOU metrics"}
```

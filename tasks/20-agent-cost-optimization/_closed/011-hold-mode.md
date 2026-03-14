# TASK-011: Hold Mode — Voice Agent Idle Detection & Release

**Status:** [x] Complete
**Priority:** HIGH (fixes BUG-027)
**Epic:** 20 — Agent Cost Optimization

## Summary

Gemini Live-style hold mode. After 60s of silence (configurable via `FLETCHER_HOLD_TIMEOUT_MS`), the voice agent sends a `session_hold` event to the client, disconnects from the room (releasing all resources), and the client shows "On hold — tap or speak to resume." On resume, the existing `AgentPresenceService` dispatches a fresh agent. The relay stays in the room and preserves the ACP session — conversation continues seamlessly.

## Changes

### Voice Agent (`apps/voice-agent/src/agent.ts`)
- [x] Add `FLETCHER_HOLD_TIMEOUT_MS` env var (default 60s, 0 to disable)
- [x] Disable SDK `userAwayTimeout: null` — prevents silent STT death (BUG-027 root cause)
- [x] Hold timer: `clearHoldTimer()` / `resetHoldTimer()` with activity event wiring
- [x] Wire to: `UserInputTranscribed`, `DataReceived`, `AgentStateChanged`, `sendBootstrap`
- [x] Shutdown cleanup: `clearHoldTimer()` in `addShutdownCallback`

### Agent Presence Service (`apps/mobile/lib/services/agent_presence_service.dart`)
- [x] Add `holdMode` parameter to `onAgentDisconnected()`
- [x] Customize disconnect message: "On hold — tap or speak to resume" vs generic

### Mobile Client (`apps/mobile/lib/services/livekit_service.dart`)
- [x] Add `_holdModeActive` flag
- [x] Handle `session_hold` ganglia event
- [x] Pass `holdMode` to `AgentPresenceService` on disconnect
- [x] Clear flag on agent connect

## Bugs Fixed

- **BUG-027** (HIGH): Silent pipeline death from SDK's 15s `userAwayTimeout` killing STT stream. Hold mode replaces this with proper idle detection and clean recovery.

## Architecture Docs Updated

- `docs/architecture/voice-pipeline.md` — Hold Mode section
- `docs/architecture/data-channel-protocol.md` — `session_hold` event type
- `docs/architecture/mobile-client.md` — AgentPresenceService hold mode

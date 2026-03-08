# TASK-030: Text-Only Response Mode (TTS Mute)

## Status
- **Status:** Complete
- **Priority:** Medium
- **Depends on:** None
- **Owner:** Unassigned
- **Created:** 2026-03-08

## Problem
There are situations where the user wants to interact with the agent silently — speaking into the mic (STT active) but receiving responses as text only, with no audio playback. Examples:
- In a quiet environment (library, meeting, late at night)
- Reading back a long response where text is preferable
- Debugging / reviewing transcripts without TTS noise

Currently there is no way to disable TTS from the client. The full voice pipeline always runs: STT → LLM → TTS → audio playback. Running TTS when the user doesn't want audio wastes compute, API tokens, and rate limit budget.

## Proposed Solution
Add a **text-only mode** toggle that signals the agent to skip TTS synthesis entirely. The client sends a data channel event; the agent suppresses TTS for subsequent turns. LLM responses are still streamed as transcripts so the chat view displays them normally.

1. **Keeps STT active** — user still speaks, speech is transcribed and sent to the LLM
2. **Agent skips TTS** — no TTS API calls, no audio frames sent to client
3. **Transcript delivery unchanged** — agent response text appears in chat as normal

## Implementation Plan

### Client (Flutter)
- [x] Add a `textOnlyMode` flag to `LiveKitService`
- [x] Add a toggle button to the UI (`[TTS: ON]` / `[TTS: OFF]` next to mic button)
- [x] On toggle, send a data channel event: `{ "type": "tts-mode", "value": "off" | "on" }`
- [x] Send current `tts-mode` state on room join / reconnect so agent picks up the preference
- [x] Persist the toggle preference (SharedPreferences via `SessionStorage`)
- [x] Chat transcript still receives and displays agent responses normally (unchanged)

### Agent (Voice Agent / AgentSession)
- [x] Listen for `tts-mode` data channel events from the client
- [x] Store per-session `ttsEnabled` flag (default: `true`)
- [x] When `ttsEnabled` is `false`, skip TTS synthesis via `session.output.setAudioEnabled(false)` — SDK natively skips `performTTSInference`
- [x] Skip acknowledgment sound when TTS is disabled

## Acceptance Criteria
- [x] User can toggle text-only mode from the UI
- [x] When text-only mode is active, no TTS API calls are made by the agent
- [x] STT continues to work — user can still speak and be transcribed
- [x] Agent responses appear in the chat transcript as normal
- [x] Toggle state is visually clear (amber `[TTS: ON]` / dim `[TTS: OFF]`)
- [x] Toggle state is communicated to agent on reconnect (not lost on network transition)
- [x] Persist preference across app restarts

## Implementation Notes

**Key discovery:** The LiveKit agents SDK supports this natively via `session.output.setAudioEnabled(false)`. When audio output is disabled, the SDK's `ttsTask` skips TTS inference entirely. Text forwarding continues normally. No wrapper TTS or SDK hacking needed.

**Files modified:**
- `apps/voice-agent/src/agent.ts` — `RoomEvent.DataReceived` listener, `ttsEnabled` flag, ack sound gating
- `apps/mobile/lib/services/livekit_service.dart` — `_textOnlyMode` flag, `_sendEvent()`, `toggleTextOnlyMode()`, send on connect/reconnect
- `apps/mobile/lib/services/session_storage.dart` — `saveTextOnlyMode()` / `getTextOnlyMode()`
- `apps/mobile/lib/screens/conversation_screen.dart` — `TuiButton` next to mic button
- `docs/architecture/data-channel-protocol.md` — documented `tts-mode` event, updated direction to bidirectional

## References
- Data channel protocol: `docs/architecture/data-channel-protocol.md`
- Voice pipeline: `docs/architecture/voice-pipeline.md`
- LiveKitService: `apps/mobile/lib/services/livekit_service.dart`

# Task: Preserve app state across reconnects

## Description
Ensure all user-visible state survives reconnection: transcript history, artifacts, ganglia status, and audio settings (mute state). Currently transcripts are preserved via `preserveTranscripts: true` on `disconnect()`, but there are edge cases and other state to consider.

## Checklist
- [ ] Audit all state cleared by `disconnect()` — ensure transcript, artifacts, and mute state survive
- [ ] Verify `_segmentContent` (in-flight transcript segments) is handled correctly — segments from the old connection should be finalized, not silently dropped
- [ ] Preserve mute state across reconnects — if user was muted, stay muted after reconnect
- [ ] Clear stale waveform buffers on reconnect (old audio levels are meaningless)
- [ ] Clear `_chunks` buffer (in-flight ganglia data channel messages) on disconnect — partial messages from old connection can't be reassembled
- [ ] Re-register `lk.transcription` text stream handler after reconnect (verify this happens in `_setupRoomListeners`)
- [ ] Test: connect → send messages → disconnect → reconnect → verify transcript history visible
- [ ] Test: connect → mute → disconnect → reconnect → verify still muted

## Context
- `apps/mobile/lib/services/livekit_service.dart` — `disconnect()` method, `_reconnectRoom()`, various state buffers
- `disconnect(preserveTranscripts: true)` skips clearing `_url`/`_token` but still clears `_segmentContent`
- Mute state (`_isMuted`) is not touched by `disconnect()` — should be fine, but verify mic is re-enabled correctly in `connect()` respecting mute state

## Why
Reconnection that loses the conversation history defeats the purpose. Users expect continuity — the reconnect should be invisible except for a brief "Reconnecting..." indicator.

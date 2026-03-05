## Related Bugs
- [BUG-021](../../docs/field-tests/20260304-buglog.md): Buffering issues on Client and Hub.
- [BUG-022](../../docs/field-tests/20260304-buglog.md): Total downstream failure during "nose holes".

# Audio Buffering & Connectivity Resilience

## Summary of Changes

Reconnection audio buffering uses the LiveKit SDK's built-in `PreConnectAudioBuffer` class (livekit_client v2.5.4) instead of a custom `AudioCaptureService`. This class creates a native mic track, captures PCM via `AudioRenderer`, and sends buffered audio via `streamBytes()` on the `lk.agent.pre-connect-audio-buffer` topic.

### Previous approach (deleted)
- Custom `AudioCaptureService` and `CustomAudioSource` classes were broken stubs — `LocalAudioTrack.createCustomTrack()` does not exist in the SDK, causing a crash on connect.

### Current approach (PreConnectAudioBuffer)
- **On `RoomReconnectingEvent`**: Create a `PreConnectAudioBuffer` and start recording with 60s timeout. This captures mic audio natively during the reconnect window.
- **On `RoomReconnectedEvent`**: Send buffered audio to agent participant(s) via `sendAudioData()`, then reset the buffer.
- **On `RoomDisconnectedEvent`**: Reset and discard the buffer (room is dying, can't send).
- **On `disconnect()`**: Clean up any active buffer.

### Files changed
- **Deleted**: `lib/services/audio_capture_service.dart`, `test/services/audio_capture_service_test.dart`
- **Modified**: `lib/services/livekit_service.dart` — removed broken custom track code, added `PreConnectAudioBuffer` reconnect logic

## Remaining Work

### Agent-side handling
`PreConnectAudioBuffer` sends on topic `lk.agent.pre-connect-audio-buffer`. The `livekit-agents` framework may already handle this topic server-side. If not, a handler needs to be added to the voice agent to receive and process the buffered audio.

### Deep network drops
The current implementation only buffers during SDK-managed reconnection (short outages). For "deep" drops where the SDK gives up entirely, the buffer is discarded. Future work could:
- Keep the `PreConnectAudioBuffer` alive across manual reconnect attempts
- Send buffered audio after a fresh `connect()` succeeds

## Task Status
- [x] Initial audio buffer integration with reconnection lifecycle
- [x] Lifecycle hooks for SDK-level reconnection
- [x] Switch to SDK `PreConnectAudioBuffer` (replaces broken `AudioCaptureService`)
- [ ] Verify agent-side handles `lk.agent.pre-connect-audio-buffer` topic
- [ ] Handle deep network drops (buffer across manual reconnect cycles)

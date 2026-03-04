# Task: Client-side audio buffering for network dead zones

## Problem

When the user walks through a cellular dead zone or experiences a brief network interruption, any speech during the gap is permanently lost. The LiveKit SDK does not buffer audio locally during disconnects — audio frames are simply dropped.

**Field test reference:** [BUG-027](../../docs/field-tests/20260303-buglog.md)

**Tester said:** "I was walking around, probably entered a dead zone and what I was saying was lost. I think we need to add an audio buffering feature to make sure we don't lose stuff the user is saying even in spotty connectivity."

## Proposed Solution

Implement a client-side audio capture buffer that:

1. **Records audio locally** while the WebRTC connection is interrupted (ICE disconnected / reconnecting state)
2. **On reconnection**, fast-forwards the buffered audio to the agent via the re-established audio track or a data channel
3. **Protects against mid-sentence drops** — if the user is speaking when the connection drops, their full utterance is captured

### Design Considerations

- **Buffer duration:** 30-60 seconds should be sufficient for most dead zone transits
- **Buffer format:** Raw PCM or Opus-encoded frames (match the existing audio track format)
- **Delivery mechanism:** Options include:
  - Re-publishing buffered frames through the audio track (simulates real-time playback at accelerated rate)
  - Sending buffered audio via data channel as a blob (requires agent-side handling)
  - Sending a text summary via STT-on-device if available
- **Memory management:** Ring buffer to cap memory usage
- **UX indicator:** Show the user that their speech is being buffered locally (e.g., "Recording locally..." indicator)

### Edge Cases

- Buffer overflow (user talks for > buffer duration while disconnected)
- Reconnect to a different agent session (buffer may be contextually irrelevant)
- Partial reconnects (connection flapping)

## Acceptance Criteria

- [ ] Audio is captured locally during network interruptions
- [ ] Buffered audio is delivered to the agent on reconnection
- [ ] Agent processes buffered audio and responds appropriately
- [ ] UI indicates when audio is being buffered locally
- [ ] Buffer has a reasonable size limit with graceful overflow handling

## Files

- `apps/mobile/lib/services/livekit_service.dart` — audio track and connection management
- `apps/mobile/lib/services/audio_buffer_service.dart` (new) — local audio buffer
- Agent-side: may need data channel handler for buffered audio delivery

## Priority

**High** — Critical for outdoor/mobile use cases with spotty connectivity.

## Status
- **Date:** 2026-03-04
- **Priority:** High
- **Status:** Not started

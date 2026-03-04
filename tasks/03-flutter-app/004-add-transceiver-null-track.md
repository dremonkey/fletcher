# Task: Fix `addTransceiver: track is null` crash during reconnect

## Problem

During rapid reconnect cycles (DUPLICATE_IDENTITY churn), the LiveKit Flutter SDK throws an unhandled exception in `rePublishAllTracks`:

```
Unhandled Exception: Unable to RTCPeerConnection::addTransceiver: addTransceiver(): track is null
  #0 RTCPeerConnectionNative.addTransceiver (rtc_peerconnection_impl.dart:619:7)
  #1 EngineInternalMethods.createTransceiverRTCRtpSender (engine.dart:1412:25)
  #2 LocalParticipant.publishAudioTrack.negotiate (local.dart:150:27)
  #5 LocalParticipant.rePublishAllTracks (local.dart:565:9)
  #6 Room._setUpEngineListeners (room.dart:543:7)
```

**Field test reference:** [BUG-025](../../docs/field-tests/20260303-buglog.md)

## Root Cause

During `rePublishAllTracks` after a reconnect, the audio track reference is null. The SDK tries to re-negotiate the transceiver with a null track. This likely happens when the audio track was disposed during the reconnect but the participant's track list wasn't updated.

## Investigation

1. Check if this is a known LiveKit Flutter SDK issue
2. Determine if our audio track lifecycle management (dispose/recreate) races with `rePublishAllTracks`
3. Consider adding a null guard before `publishAudioTrack` in our reconnect flow

## Acceptance Criteria

- [ ] No unhandled `addTransceiver` exceptions during reconnect cycles
- [ ] Audio track is properly recreated after reconnect if disposed

## Files

- `apps/mobile/lib/services/livekit_service.dart` — reconnection and track management
- LiveKit SDK: `livekit_client/src/participant/local.dart` — `rePublishAllTracks`

## Priority

**Medium** — Non-fatal but may cause audio issues after reconnect.

## Status
- **Date:** 2026-03-04
- **Priority:** Medium
- **Status:** Not started

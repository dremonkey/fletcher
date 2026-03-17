# Task 093: Fix ghost data channel after SDK reconnect

## Problem

After a LiveKit SDK reconnect (network handoff, brief disconnect), the mobile client
shows "Connected" but the data channel to the relay is dead. User messages vanish
silently; no responses arrive. The only recovery is force-quitting the app. (BUG-045)

## Investigation

### Theory 1: RoomReconnectedEvent doesn't re-validate relay binding

**Confirmed — this is the primary root cause.** The `RoomReconnectedEvent` handler
(`livekit_service.dart:574-626`) restores the UI to idle/muted status without checking
whether the relay participant is still present or the data channel is functional.

`_sessionBound` stays `true` from the pre-reconnect state, so no new `session/bind`
is sent. If the relay also disconnected and rejoined during the same window (new
participant SID, fresh pending-bind state), it waits 30s for a bind that never arrives,
then leaves the room. The mobile client remains unaware.

The handler was written for voice-mode reconnection (BUG-027 audio buffer flush) and
never updated when the relay data channel (Epic 22) was added.

### Theory 2: Relay bridge stays "started" after ACP death

**Confirmed — contributing cause.** When the ACP subprocess dies, the relay bridge
sets `needsReinit = true` but stays started with data handlers registered
(`relay-bridge.ts:222-228`). If no new message arrives from mobile (because the data
channel is also degraded), the bridge is a zombie — occupies the room, appears healthy,
processes nothing. No notification is sent to the mobile client.

### Theory 3: No heartbeat or timeout on the data channel

**Confirmed — contributing cause.** Neither side implements liveness probes.
`RelayChatService.sendPrompt()` (`relay_chat_service.dart:128-154`) has no timeout —
the stream stays open indefinitely. Once stuck, `isBusy` returns `true` and blocks all
subsequent sends. The UI shows no error.

### Theory 4: Relay participant replacement coalesced by SDK

**Plausible — contributes to root cause 1.** When the relay rejoins with the same
identity string, LiveKit may coalesce this as a participant update rather than
disconnect+connect events. Mobile sees no `ParticipantDisconnectedEvent` (so
`_sessionBound` stays true) and no `ParticipantConnectedEvent` (so no new bind).

## Proposed Fix

### Change 1: Re-validate relay binding on SDK reconnect (CRITICAL)

**File:** `apps/mobile/lib/services/livekit_service.dart`
**Location:** `RoomReconnectedEvent` handler (~line 574)

Reset `_sessionBound = false` and re-send `session/bind` if a relay participant
is present:

```dart
_listener?.on<RoomReconnectedEvent>((_) async {
  // ... existing code (status restore, buffer flush, audio refresh) ...

  // Re-validate relay state after SDK reconnect (BUG-045)
  _sessionBound = false;
  if (_hasRelayParticipant) {
    _sendSessionBind();
  }
  // If relay is gone, ParticipantConnectedEvent will send bind when it rejoins
});
```

### Change 2: Add prompt timeout to RelayChatService (CRITICAL)

**File:** `apps/mobile/lib/services/relay/relay_chat_service.dart`
**Location:** `sendPrompt()` (~line 128)

Add a configurable timeout (default 30s) that closes the stream with an error if
no response arrives:

```dart
Timer(timeout, () {
  if (_activeStream != null && _activeRequestId == id) {
    _activeStream?.add(RelayPromptError(-32000, 'Prompt timed out'));
    _activeStream?.close();
    _activeStream = null;
    _activeRequestId = null;
  }
});
```

### Change 3: Add session/bind retry with timeout

**File:** `apps/mobile/lib/services/livekit_service.dart`
**Location:** `_sendSessionBind()` (~line 1696)

Wrap in a retry loop: re-send after 10s if no bind response, give up after 3
attempts and emit a system error event.

### Change 4: Relay notifies mobile when ACP dies

**File:** `apps/relay/src/bridge/relay-bridge.ts`
**Location:** `onExit` handler (~line 222)

Send a JSON-RPC notification to mobile so the client can surface the error:

```typescript
this.forwardToMobile({
  jsonrpc: "2.0",
  method: "session/update",
  params: { error: { code: -32010, message: "ACP connection lost" } },
});
```

### Change 5: Relay stops bridge on dead forward path

**File:** `apps/relay/src/bridge/relay-bridge.ts`
**Location:** `forwardToMobile` (~line 694)

When `forwardFailures >= MAX_CONSECUTIVE_FAILURES`, stop the bridge instead of
just logging. Let the room discovery mechanism create a fresh connection.

## Acceptance Criteria

- [x] After SDK reconnect, `session/bind` is re-sent to the relay
- [x] Prompt timeout (30s) surfaces an error to the user instead of hanging forever
- [x] `session/bind` retries up to 3 times with 10s intervals
- [x] Relay sends error notification to mobile when ACP subprocess dies
- [x] Relay stops bridge after 3 consecutive forward failures
- [x] Existing reconnect behavior (voice mode buffer, audio refresh) unchanged

## Files

- `apps/mobile/lib/services/livekit_service.dart` — reconnect handler, bind retry
- `apps/mobile/lib/services/relay/relay_chat_service.dart` — prompt timeout
- `apps/relay/src/bridge/relay-bridge.ts` — ACP death notification, forward-path stop

## Status

- **Date:** 2026-03-16
- **Priority:** HIGH
- **Bug:** BUG-045
- **Status:** COMPLETE

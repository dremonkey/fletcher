# Task: Filter DisconnectReason before auto-reconnect

## Description
Currently `_reconnectRoom()` fires on every `RoomDisconnectedEvent` regardless of why the disconnect happened. This is wrong for several cases — reconnecting after `clientInitiated` fights the user's intent, reconnecting after `duplicateIdentity` creates an infinite loop, and reconnecting after `participantRemoved` or `roomDeleted` is futile.

## Checklist
- [ ] Extract `DisconnectReason` from `RoomDisconnectedEvent` (available as `event.reason`)
- [ ] Define reconnectable reasons: `disconnected`, `signalingConnectionFailure`, `reconnectAttemptsExceeded`, `unknown`
- [ ] Define non-reconnectable reasons: `clientInitiated`, `duplicateIdentity`, `participantRemoved`, `roomDeleted`, `serverShutdown`, `joinFailure`, `stateMismatch`
- [ ] Only trigger `_reconnectRoom()` for reconnectable reasons
- [ ] Show appropriate error messages for non-reconnectable reasons (e.g., "Removed from room" vs "Connection lost")
- [ ] Log the disconnect reason for debugging

## Context
- `apps/mobile/lib/services/livekit_service.dart` — `RoomDisconnectedEvent` handler in `_setupRoomListeners()`
- `DisconnectReason` enum from `livekit_client` package: `unknown`, `clientInitiated`, `duplicateIdentity`, `serverShutdown`, `participantRemoved`, `roomDeleted`, `stateMismatch`, `joinFailure`, `disconnected`, `signalingConnectionFailure`, `reconnectAttemptsExceeded`

## Why
Without reason filtering, the app can enter infinite reconnect loops (duplicate identity) or fight user intent (manual disconnect). This is a correctness issue, not just polish.

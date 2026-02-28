# Task: Hook into LiveKit SDK reconnection events

## Description
The LiveKit SDK performs up to 10 automatic reconnect attempts (with quadratic backoff up to 7s) before firing `RoomDisconnectedEvent`. During this window (~40s), the app shows no feedback to the user — the UI stays on whatever state it was in. We need to listen to the SDK's own reconnection events so the user sees "Reconnecting..." immediately when the connection drops, not 40 seconds later.

## Checklist
- [x] Listen to `RoomReconnectingEvent` → set status to `ConversationStatus.reconnecting`
- [x] Listen to `RoomAttemptReconnectEvent` → log attempt number/max for debugging
- [x] Listen to `RoomReconnectedEvent` → set status back to `ConversationStatus.idle`, update health service
- [x] Update health chip to amber/warning during SDK reconnection (not red — red means fully disconnected)
- [x] Verify that if SDK reconnection succeeds, our custom `_reconnectRoom()` is never triggered

## Context
- `apps/mobile/lib/services/livekit_service.dart` — `_setupRoomListeners()` is where new listeners go
- LiveKit SDK events: `RoomReconnectingEvent`, `RoomAttemptReconnectEvent`, `RoomReconnectedEvent`
- `RoomReconnectedEvent` only fires on full ICE reconnect, not on simple resume — may need to handle both paths
- SDK retry schedule: `n² × 300ms`, capped at 7s, up to 10 attempts

## Why
Without this, there's a ~40 second gap where the user has no idea the connection is broken. The SDK is silently trying to recover, but the UI shows everything as normal.

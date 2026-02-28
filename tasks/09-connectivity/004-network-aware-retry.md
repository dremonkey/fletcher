# Task: Network-aware reconnection strategy

## Description
Replace the fixed 3-attempt retry with a network-aware strategy. When offline, pause retries entirely and wait for connectivity to return. When online, retry with reasonable backoff. This handles the "go offline for a few minutes and resume as if nothing happened" scenario.

## Checklist
- [ ] In `_reconnectRoom()`, check `isOnline` before attempting reconnect
- [ ] If offline: set status to `reconnecting`, subscribe to connectivity stream, wait for network restore
- [ ] On network restore: reset attempt counter and begin reconnect sequence
- [ ] If online: use current exponential backoff (1s, 2s, 4s) but increase max attempts to ~5
- [ ] On WiFi ↔ Cellular switch: connectivity stream fires `none` then `wifi`/`cellular` — debounce to avoid spurious reconnects
- [ ] Cancel pending connectivity subscription on manual disconnect or dispose
- [ ] Update `tryReconnect()` (app resume handler) to also check connectivity before retrying
- [ ] Guard against concurrent reconnects from multiple triggers (network restore + app resume + SDK disconnect can all fire close together)

## Context
- `apps/mobile/lib/services/livekit_service.dart` — `_reconnectRoom()` and `tryReconnect()`
- Depends on task 003 (`ConnectivityService` / `isOnline` getter)
- The LiveKit SDK's built-in 10-attempt reconnect (task 001) handles brief network blips; this task handles longer outages where the SDK has already given up

## Design
```
Disconnect detected
  ├─ SDK tries 10 reconnects (~40s) ← task 001 shows UI feedback
  ├─ SDK gives up → RoomDisconnectedEvent
  ├─ Check DisconnectReason ← task 002 filters
  ├─ Check isOnline
  │   ├─ Online → retry with backoff (up to 5 attempts)
  │   └─ Offline → show "Waiting for network...", subscribe to connectivity
  │       └─ Network restored → retry with backoff
  └─ All retries exhausted → show error with manual retry button
```

## Why
The current 3-attempt / 7-second retry budget is too small for real-world scenarios like airplane mode, tunnel, or walking between WiFi networks. Users expect the app to "just work" when connectivity returns.

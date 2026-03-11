# R-011: Idle Timeout (Disconnect After 5 Min Inactivity)

**Depends On:** R-002  
**Blocks:** None  
**Effort:** 2 hours  

## Objective
Disconnect from LiveKit room after 5 minutes of no activity.

## Reference
See `docs/room-metadata-schema.md` section "Idle Mode"

## Key Logic
```typescript
// Check idle every 30 seconds
setInterval(() => {
  for (const connection of participantManager.getAllConnections()) {
    if (participantManager.isIdle(connection.roomName)) {
      // Set room metadata to "idle"
      await updateRoomMetadata(connection.roomName, { mode: 'idle' });
      // Disconnect
      await participantManager.leaveRoom(connection.roomName);
    }
  }
}, 30000);
```

## Acceptance Criteria
✅ Idle timeout = 5 min (configurable via env)  
✅ Idle check runs every 30s  
✅ Room metadata set to `mode: "idle"` before disconnect  
✅ Relay disconnects from room

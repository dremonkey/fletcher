# R-002: LiveKit Participant Manager (Join/Leave Rooms)

**Epic:** Fletcher Relay MVP  
**Status:** 📋 Ready for Implementation  
**Depends On:** R-001  
**Blocks:** R-003, R-011  
**Effort:** 2 hours  

---

## Objective

Implement a LiveKit participant manager that can join/leave rooms on demand as a non-agent server-side participant.

---

## Acceptance Criteria

✅ `ParticipantManager` class can connect to LiveKit room  
✅ Graceful disconnect on idle or shutdown  
✅ Reconnection logic with exponential backoff  
✅ Room metadata reading (for voice/chat mode coordination)  
✅ Participant leaves room when no longer needed  
✅ Error handling for network failures  

---

## Implementation

### File: `src/livekit/participant.ts`

```typescript
import {
  Room,
  RoomEvent,
  ConnectionState,
  DataPacket_Kind,
  RemoteParticipant,
} from '@livekit/rtc-node';
import { env } from '../utils/env';
import { logger } from '../utils/logger';

export interface RoomConnection {
  room: Room;
  roomName: string;
  connectedAt: number;
  lastActivity: number;
}

export class ParticipantManager {
  private connections = new Map<string, RoomConnection>();
  private reconnectAttempts = new Map<string, number>();
  
  /**
   * Join a LiveKit room as a non-agent participant.
   */
  async joinRoom(roomName: string, token: string): Promise<RoomConnection> {
    // Check if already connected
    const existing = this.connections.get(roomName);
    if (existing && existing.room.state === ConnectionState.CONNECTED) {
      logger.info(`Already connected to room ${roomName}`);
      return existing;
    }

    const room = new Room();
    
    // Set up event handlers
    room.on(RoomEvent.Connected, () => {
      logger.info(`Connected to room ${roomName}`);
      this.reconnectAttempts.delete(roomName);
    });

    room.on(RoomEvent.Disconnected, (reason?: string) => {
      logger.warn(`Disconnected from room ${roomName}: ${reason}`);
      this.handleDisconnect(roomName);
    });

    room.on(RoomEvent.Reconnecting, () => {
      logger.info(`Reconnecting to room ${roomName}...`);
    });

    room.on(RoomEvent.Reconnected, () => {
      logger.info(`Reconnected to room ${roomName}`);
      this.reconnectAttempts.delete(roomName);
    });

    room.on(RoomEvent.RoomMetadataChanged, (metadata: string) => {
      logger.debug(`Room metadata changed: ${metadata}`);
      this.handleMetadataChange(roomName, metadata);
    });

    // Connect to room
    try {
      await room.connect(env.LIVEKIT_URL, token, {
        autoSubscribe: true,
        dynacast: false,
      });

      const connection: RoomConnection = {
        room,
        roomName,
        connectedAt: Date.now(),
        lastActivity: Date.now(),
      };

      this.connections.set(roomName, connection);
      return connection;
    } catch (error) {
      logger.error(`Failed to connect to room ${roomName}:`, error);
      throw new Error(`Room connection failed: ${error}`);
    }
  }

  /**
   * Leave a room and clean up resources.
   */
  async leaveRoom(roomName: string): Promise<void> {
    const connection = this.connections.get(roomName);
    if (!connection) {
      logger.warn(`Attempted to leave room ${roomName} but not connected`);
      return;
    }

    try {
      await connection.room.disconnect();
      this.connections.delete(roomName);
      this.reconnectAttempts.delete(roomName);
      logger.info(`Left room ${roomName}`);
    } catch (error) {
      logger.error(`Error leaving room ${roomName}:`, error);
      this.connections.delete(roomName); // Force cleanup
    }
  }

  /**
   * Get room connection if exists.
   */
  getConnection(roomName: string): RoomConnection | undefined {
    return this.connections.get(roomName);
  }

  /**
   * Get all active connections.
   */
  getAllConnections(): RoomConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Update last activity timestamp for idle timeout tracking.
   */
  touchActivity(roomName: string): void {
    const connection = this.connections.get(roomName);
    if (connection) {
      connection.lastActivity = Date.now();
    }
  }

  /**
   * Check if room is idle (no activity for configured timeout).
   */
  isIdle(roomName: string): boolean {
    const connection = this.connections.get(roomName);
    if (!connection) return true;

    const idleDuration = Date.now() - connection.lastActivity;
    return idleDuration > env.RELAY_IDLE_TIMEOUT_MS;
  }

  /**
   * Get room metadata (for mode coordination).
   */
  getMetadata(roomName: string): Record<string, any> {
    const connection = this.connections.get(roomName);
    if (!connection) return {};

    try {
      const metadataStr = connection.room.metadata || '{}';
      return JSON.parse(metadataStr);
    } catch (error) {
      logger.warn(`Failed to parse room metadata: ${error}`);
      return {};
    }
  }

  /**
   * Handle disconnect event (cleanup + optional reconnect).
   */
  private handleDisconnect(roomName: string): void {
    const attempts = this.reconnectAttempts.get(roomName) || 0;
    const maxAttempts = 5;

    if (attempts >= maxAttempts) {
      logger.error(`Max reconnection attempts reached for room ${roomName}, giving up`);
      this.connections.delete(roomName);
      this.reconnectAttempts.delete(roomName);
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    const backoffMs = Math.min(1000 * Math.pow(2, attempts), 16000);
    this.reconnectAttempts.set(roomName, attempts + 1);

    logger.info(`Will retry connection to room ${roomName} in ${backoffMs}ms (attempt ${attempts + 1}/${maxAttempts})`);

    setTimeout(() => {
      // Reconnection is handled automatically by LiveKit SDK
      // This timeout is just for logging/cleanup
    }, backoffMs);
  }

  /**
   * Handle room metadata change (mode coordination).
   */
  private handleMetadataChange(roomName: string, metadata: string): void {
    try {
      const data = JSON.parse(metadata || '{}');
      const mode = data.mode || 'idle';
      
      if (mode === 'voice') {
        logger.info(`Room ${roomName} switched to voice mode, relay should enter passive state`);
        // TODO (Task R-011): Implement passive state logic
      } else if (mode === 'chat') {
        logger.info(`Room ${roomName} in chat mode, relay is active`);
      }
    } catch (error) {
      logger.warn(`Failed to parse metadata change: ${error}`);
    }
  }

  /**
   * Cleanup all connections (shutdown).
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down participant manager...');
    const disconnectPromises = Array.from(this.connections.keys()).map(roomName =>
      this.leaveRoom(roomName)
    );
    await Promise.allSettled(disconnectPromises);
    logger.info('Participant manager shutdown complete');
  }
}
```

---

## Usage Example

**`src/index.ts` (integration):**

```typescript
import { ParticipantManager } from './livekit/participant';
import { generateToken } from './livekit/token-generator';

const participantManager = new ParticipantManager();

// Join room (called when token server signals)
const token = await generateToken('room-abc123', {
  identity: 'fletcher-relay',
  name: 'Fletcher Relay',
  metadata: JSON.stringify({ type: 'relay' }),
});

const connection = await participantManager.joinRoom('room-abc123', token);
console.log('Connected to room:', connection.roomName);

// Check room metadata (mode coordination)
const metadata = participantManager.getMetadata('room-abc123');
if (metadata.mode === 'voice') {
  console.log('Voice mode active, relay is passive');
}

// Leave room after idle timeout
if (participantManager.isIdle('room-abc123')) {
  await participantManager.leaveRoom('room-abc123');
}
```

---

## Token Generation

**File: `src/livekit/token-generator.ts`:**

```typescript
import { AccessToken } from 'livekit-server-sdk';
import { env } from '../utils/env';

export interface ParticipantOptions {
  identity: string;
  name?: string;
  metadata?: string;
}

export async function generateToken(
  roomName: string,
  options: ParticipantOptions
): Promise<string> {
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: options.identity,
    name: options.name,
    metadata: options.metadata,
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return at.toJwt();
}
```

**Dependencies (add to `package.json`):**
```json
{
  "dependencies": {
    "livekit-server-sdk": "^2.0.0"
  }
}
```

---

## Error Handling

### Network Failures

**Scenario:** LiveKit server unreachable.

**Behavior:**
- `room.connect()` throws error
- Relay logs error, returns HTTP 503 to token server
- Token server retries after backoff

### Reconnection

**Scenario:** Room connection drops (network switch, server restart).

**Behavior:**
- LiveKit SDK automatically attempts reconnection (up to 5 attempts)
- `ParticipantManager` tracks attempts for logging
- After max attempts → clean up connection, relay leaves room

### Invalid Metadata

**Scenario:** Room metadata is malformed JSON.

**Behavior:**
- `getMetadata()` catches parse error, returns `{}`
- Treats as `mode: "idle"` (safe default)
- Logs warning for debugging

---

## Testing

### Unit Tests (`test/participant.test.ts`)

```typescript
import { test, expect, mock } from 'bun:test';
import { ParticipantManager } from '../src/livekit/participant';

test('ParticipantManager tracks activity', () => {
  const manager = new ParticipantManager();
  // Mock connection
  const mockConnection = {
    room: {} as any,
    roomName: 'test-room',
    connectedAt: Date.now(),
    lastActivity: Date.now() - 6 * 60 * 1000, // 6 minutes ago
  };
  manager['connections'].set('test-room', mockConnection);

  expect(manager.isIdle('test-room')).toBe(true);

  manager.touchActivity('test-room');
  expect(manager.isIdle('test-room')).toBe(false);
});
```

### Integration Test (Manual)

1. Start LiveKit server (local or cloud)
2. Run relay with `bun run dev`
3. Trigger `/relay/join` endpoint with room name
4. Verify relay appears as participant in LiveKit dashboard
5. Disconnect relay, verify cleanup

---

## Success Criteria

- [ ] Relay can join LiveKit room as non-agent participant
- [ ] Relay can disconnect gracefully from room
- [ ] Reconnection logic handles network failures (5 retries with backoff)
- [ ] Room metadata is readable (for mode coordination)
- [ ] Idle timeout tracking works (last activity timestamp)
- [ ] Multiple rooms can be managed simultaneously
- [ ] Shutdown cleanup disconnects all rooms

---

## Next Steps

Once this task is complete:
- **R-003:** Subscribe to `relay` data channel topic
- **R-011:** Implement idle timeout logic (disconnect after 5min inactivity)

---

**Status:** Ready for implementation. Requires R-001 (project scaffold) to be complete.

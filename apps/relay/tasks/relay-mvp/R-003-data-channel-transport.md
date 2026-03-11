# R-003: Data Channel Transport (Subscribe to `relay` Topic)

**Epic:** Fletcher Relay MVP  
**Status:** 📋 Ready for Implementation  
**Depends On:** R-001, R-002  
**Blocks:** R-005  
**Effort:** 2 hours  

---

## Objective

Implement LiveKit data channel transport layer for sending/receiving messages on the `relay` topic.

---

## Acceptance Criteria

✅ Subscribe to `relay` data channel topic  
✅ Receive messages from mobile client  
✅ Send messages to mobile client  
✅ Handle chunked messages (>16 KB)  
✅ UTF-8 encoding/decoding  
✅ Error handling for malformed data  

---

## Implementation

### File: `src/data-channel/transport.ts`

```typescript
import { Room, RemoteParticipant, DataPacket_Kind } from '@livekit/rtc-node';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const RELAY_TOPIC = 'relay';
const MAX_CHUNK_SIZE = 15 * 1024; // 15 KB (leaves 1 KB for envelope)

export interface DataChannelMessage {
  data: string; // JSON string
  participant: RemoteParticipant;
  timestamp: number;
}

export type MessageHandler = (message: DataChannelMessage) => void;

export class DataChannelTransport {
  private room: Room;
  private messageHandler?: MessageHandler;
  private chunks = new Map<string, Map<number, string>>(); // transferId → chunkIndex → data
  private chunkMetadata = new Map<string, { totalChunks: number; receivedAt: number }>();

  constructor(room: Room) {
    this.room = room;
    this.setupDataChannelListener();
    this.startChunkCleanup();
  }

  /**
   * Set callback for incoming messages.
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Send a message to a specific participant.
   */
  async sendToParticipant(participant: RemoteParticipant, data: string): Promise<void> {
    const dataBytes = Buffer.from(data, 'utf-8');

    if (dataBytes.length <= MAX_CHUNK_SIZE) {
      // Send directly (no chunking needed)
      await participant.publishData(dataBytes, {
        reliable: true,
        topic: RELAY_TOPIC,
      });
      logger.debug(`Sent message to ${participant.identity} (${dataBytes.length} bytes)`);
    } else {
      // Chunk large message
      await this.sendChunked(participant, dataBytes);
    }
  }

  /**
   * Broadcast a message to all participants in the room.
   */
  async broadcast(data: string): Promise<void> {
    const promises = Array.from(this.room.remoteParticipants.values()).map(participant =>
      this.sendToParticipant(participant, data)
    );
    await Promise.allSettled(promises);
  }

  /**
   * Send chunked message (for data >16 KB).
   */
  private async sendChunked(participant: RemoteParticipant, dataBytes: Buffer): Promise<void> {
    const transferId = uuidv4();
    const totalChunks = Math.ceil(dataBytes.length / MAX_CHUNK_SIZE);
    logger.info(`Chunking message: ${dataBytes.length} bytes → ${totalChunks} chunks`);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * MAX_CHUNK_SIZE;
      const end = Math.min(start + MAX_CHUNK_SIZE, dataBytes.length);
      const chunkData = dataBytes.slice(start, end).toString('base64');

      const envelope = JSON.stringify({
        jsonrpc: '2.0',
        method: i === 0 ? 'chunk/start' : i === totalChunks - 1 ? 'chunk/end' : 'chunk/continue',
        params: {
          transferId,
          chunkIndex: i,
          ...(i === 0 && { totalChunks }),
          data: chunkData,
        },
      });

      await participant.publishData(Buffer.from(envelope, 'utf-8'), {
        reliable: true,
        topic: RELAY_TOPIC,
      });

      logger.debug(`Sent chunk ${i + 1}/${totalChunks} to ${participant.identity}`);
    }
  }

  /**
   * Set up data channel listener.
   */
  private setupDataChannelListener(): void {
    this.room.on('dataReceived', (data: Uint8Array, participant: RemoteParticipant, kind: DataPacket_Kind, topic?: string) => {
      if (topic !== RELAY_TOPIC) {
        return; // Ignore other topics (e.g., ganglia-events)
      }

      try {
        const dataStr = Buffer.from(data).toString('utf-8');
        const json = JSON.parse(dataStr);

        // Handle chunked messages
        if (json.method && json.method.startsWith('chunk/')) {
          this.handleChunk(json, participant);
          return;
        }

        // Handle normal message
        this.messageHandler?.({
          data: dataStr,
          participant,
          timestamp: Date.now(),
        });
      } catch (error) {
        logger.error(`Failed to parse data channel message: ${error}`);
        // Send PARSE_ERROR back to client
        this.sendError(participant, -32700, 'Parse error', null);
      }
    });
  }

  /**
   * Handle incoming chunk.
   */
  private handleChunk(json: any, participant: RemoteParticipant): void {
    const { transferId, chunkIndex, totalChunks, data } = json.params;

    if (!transferId || chunkIndex === undefined || !data) {
      logger.warn('Malformed chunk message, ignoring');
      return;
    }

    // Initialize chunk storage
    if (json.method === 'chunk/start') {
      this.chunks.set(transferId, new Map());
      this.chunkMetadata.set(transferId, {
        totalChunks,
        receivedAt: Date.now(),
      });
    }

    // Store chunk
    const chunkMap = this.chunks.get(transferId);
    if (!chunkMap) {
      logger.warn(`Received chunk for unknown transferId ${transferId}, ignoring`);
      return;
    }

    chunkMap.set(chunkIndex, data);

    // Check if complete
    const metadata = this.chunkMetadata.get(transferId);
    if (metadata && chunkMap.size === metadata.totalChunks) {
      this.reassembleChunks(transferId, chunkMap, participant);
    }
  }

  /**
   * Reassemble chunked message.
   */
  private reassembleChunks(transferId: string, chunkMap: Map<number, string>, participant: RemoteParticipant): void {
    try {
      const sortedChunks = Array.from(chunkMap.entries()).sort((a, b) => a[0] - b[0]);
      const allBytes: number[] = [];

      for (const [_, chunkData] of sortedChunks) {
        const decoded = Buffer.from(chunkData, 'base64');
        allBytes.push(...decoded);
      }

      const reassembled = Buffer.from(allBytes).toString('utf-8');
      logger.info(`Reassembled chunked message: ${allBytes.length} bytes`);

      // Process reassembled message
      this.messageHandler?.({
        data: reassembled,
        participant,
        timestamp: Date.now(),
      });
    } catch (error) {
      logger.error(`Failed to reassemble chunks: ${error}`);
      this.sendError(participant, -32700, 'Chunk reassembly failed', null);
    } finally {
      // Cleanup
      this.chunks.delete(transferId);
      this.chunkMetadata.delete(transferId);
    }
  }

  /**
   * Send JSON-RPC error to participant.
   */
  private async sendError(participant: RemoteParticipant, code: number, message: string, id: any): Promise<void> {
    const error = JSON.stringify({
      jsonrpc: '2.0',
      error: { code, message },
      id,
    });
    await this.sendToParticipant(participant, error);
  }

  /**
   * Clean up stale chunks (30s timeout).
   */
  private startChunkCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [transferId, metadata] of this.chunkMetadata.entries()) {
        if (now - metadata.receivedAt > 30000) {
          logger.warn(`Chunk timeout: transferId ${transferId}, discarding`);
          this.chunks.delete(transferId);
          this.chunkMetadata.delete(transferId);
        }
      }
    }, 10000); // Check every 10s
  }
}
```

---

## Dependencies

Add to `package.json`:
```json
{
  "dependencies": {
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "@types/uuid": "^9.0.0"
  }
}
```

---

## Usage Example

**`src/index.ts` (integration):**

```typescript
import { ParticipantManager } from './livekit/participant';
import { DataChannelTransport } from './data-channel/transport';

const participantManager = new ParticipantManager();
const connection = await participantManager.joinRoom('room-abc123', token);

const transport = new DataChannelTransport(connection.room);

// Set up message handler
transport.onMessage((message) => {
  console.log('Received message from', message.participant.identity);
  console.log('Data:', message.data);
  
  // Parse JSON-RPC (Task R-004 will handle this)
  const rpc = JSON.parse(message.data);
  console.log('Method:', rpc.method);
});

// Send response
await transport.sendToParticipant(remoteParticipant, JSON.stringify({
  jsonrpc: '2.0',
  result: { sessionId: 'sess_abc' },
  id: 1,
}));
```

---

## Testing

### Unit Tests (`test/transport.test.ts`)

```typescript
import { test, expect } from 'bun:test';

test('Chunk size calculation', () => {
  const dataSize = 50 * 1024; // 50 KB
  const chunkSize = 15 * 1024;
  const totalChunks = Math.ceil(dataSize / chunkSize);
  expect(totalChunks).toBe(4); // 15 + 15 + 15 + 5 KB
});

test('Base64 chunking roundtrip', () => {
  const original = 'Hello, world! 🚀';
  const bytes = Buffer.from(original, 'utf-8');
  const base64 = bytes.toString('base64');
  const decoded = Buffer.from(base64, 'base64').toString('utf-8');
  expect(decoded).toBe(original);
});
```

### Integration Test (Manual)

1. Connect relay to test room
2. Send message from mobile client via `relay` topic
3. Verify relay receives message
4. Send response from relay
5. Verify mobile client receives response
6. Send large message (>16 KB) and verify chunking works

---

## Success Criteria

- [ ] Relay subscribes to `relay` data channel topic
- [ ] Relay receives messages from mobile client (UTF-8 decoded)
- [ ] Relay sends messages to specific participant
- [ ] Chunked messages (>16 KB) are reassembled correctly
- [ ] Stale chunks are cleaned up after 30s timeout
- [ ] Parse errors are handled gracefully (send JSON-RPC error)
- [ ] Other data channel topics (e.g., `ganglia-events`) are ignored

---

## Next Steps

Once this task is complete:
- **R-004:** Implement JSON-RPC 2.0 parser/serializer
- **R-005:** Implement RPC method dispatcher

---

**Status:** Ready for implementation. Requires R-001, R-002 to be complete.

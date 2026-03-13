# LiveKit Participant Manager

**Status:** [x] Complete
**Depends on:** Nothing
**Blocks:** data-channel-acp-bridge

## Objective

Replace the raw WebSocket server with a LiveKit non-agent participant. The relay joins LiveKit rooms using `@livekit/rtc-node` and communicates via data channel on the `"relay"` topic.

## What exists

- `src/index.ts` runs `Bun.serve()` with WebSocket on `/ws`
- WebSocket assigns connection IDs, routes messages to RPC handler
- HTTP routes (`/health`, `/sessions`) are on the same server

## What to build

### LiveKit participant

```typescript
import { Room, RoomEvent, DataPacket_Kind } from '@livekit/rtc-node';

// Join a room
const room = new Room();
await room.connect(LIVEKIT_URL, token);

// Subscribe to data channel
room.on(RoomEvent.DataReceived, (data, participant, kind, topic) => {
  if (topic !== 'relay') return;
  const msg = JSON.parse(data.toString('utf-8'));
  // forward to ACP client (data-channel-acp-bridge)
});

// Publish to data channel
function sendToMobile(msg: object) {
  room.localParticipant.publishData(
    Buffer.from(JSON.stringify(msg)),
    { reliable: true, topic: 'relay' }
  );
}
```

### Room manager

The relay may be in multiple rooms simultaneously. Track active rooms:

```typescript
interface RoomConnection {
  room: Room;
  roomName: string;
  lastActivity: number;
}
```

### Changes to existing code

- Remove WebSocket handling from `src/index.ts`
- Keep HTTP server (Bun.serve without WebSocket upgrade) for `/health` and `/relay/join`
- Add `@livekit/rtc-node` and `livekit-server-sdk` dependencies

### Token generation

The relay generates its own LiveKit token to join rooms (it has the API key/secret):

```typescript
import { AccessToken } from 'livekit-server-sdk';

function generateRelayToken(roomName: string): string {
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: `relay-${roomName}`,
  });
  token.addGrant({ room: roomName, roomJoin: true, canPublishData: true });
  return token.toJwt();
}
```

## Acceptance criteria

- [ ] Relay can join a LiveKit room as a non-agent participant
- [ ] Relay receives data channel messages on topic `"relay"`
- [ ] Relay can publish data channel messages on topic `"relay"`
- [ ] Relay can be in multiple rooms simultaneously
- [ ] Relay generates its own tokens (no external token server needed for self-join)
- [ ] HTTP server still serves `/health`
- [ ] Old WebSocket code is removed
- [ ] Tests updated (mock LiveKit room for unit tests)

## Environment

```bash
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

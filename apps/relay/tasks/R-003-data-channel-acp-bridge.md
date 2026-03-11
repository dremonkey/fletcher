# R-003: Data Channel ↔ ACP Bridge

**Status:** [ ] Not started
**Depends on:** R-001 (LiveKit participant), R-002 (ACP client)
**Blocks:** Nothing (this is the core relay functionality)

## Objective

Wire the LiveKit data channel to the ACP client. Messages from mobile are forwarded to ACPX. Responses from ACPX are forwarded to mobile. The relay is a transparent bridge with minimal enrichment.

## Message flow

```
Mobile                      Relay                       ACPX
  │                           │                           │
  │ session/prompt ──────────▶│                           │
  │ (no sessionId)            │── session/prompt ────────▶│
  │                           │   (+ sessionId)           │
  │                           │                           │
  │                           │◀── session/update ───────│
  │◀── session/update ────────│   (forwarded as-is)       │
  │                           │                           │
  │                           │◀── result ───────────────│
  │◀── result ────────────────│   (forwarded as-is)       │
```

## What to build

### Bridge logic

```typescript
// Data channel → ACP
room.on(RoomEvent.DataReceived, (data, participant, kind, topic) => {
  if (topic !== 'relay') return;
  const msg = JSON.parse(data.toString('utf-8'));

  if (msg.method === 'session/prompt') {
    // Enrich: add sessionId from the ACP session for this room
    msg.params.sessionId = getSessionIdForRoom(room.name);
    acpClient.send(msg);
  } else if (msg.method === 'session/cancel') {
    acpClient.send(msg);
  }
  // Unknown methods: ignore (don't error — future extensibility)
});

// ACP → Data channel
acpClient.onNotification('session/update', (notification) => {
  sendToMobile(room, notification);
});

acpClient.onResponse((response) => {
  // Forward prompt result (stopReason) or error
  sendToMobile(room, response);
});
```

### Room ↔ ACP mapping

Each room gets one ACP client (one ACPX subprocess):

```typescript
interface RoomBridge {
  room: Room;
  acpClient: AcpClient;
  sessionId: string;        // From session/new response
  lastActivity: number;
}
```

When a room is joined (via R-001):
1. Spawn ACPX subprocess
2. Send `initialize`
3. Send `session/new` with `_meta` derived from room name + participant identity
4. Store `sessionId` from response
5. Start forwarding

### Mode check

Before forwarding `session/prompt`, check room metadata:

```typescript
if (room.metadata?.mode === 'voice') {
  sendToMobile(room, {
    jsonrpc: '2.0',
    id: msg.id,
    error: { code: -32003, message: 'Voice mode active, chat unavailable' }
  });
  return;
}
```

See `docs/room-metadata-schema.md` for mode coordination.

## Changes to existing code

- `src/rpc/handler.ts` — Remove custom method dispatch (session/new, session/message, etc.). Replace with ACP forwarding.
- `src/session/manager.ts` — Simplify. The relay no longer manages conversation state (ACPX/OpenClaw does). The relay only tracks room → ACP session mappings.
- `src/session/agent-bridge.ts` — Delete. Replaced by ACP client (R-002).
- `src/session/types.ts` — Simplify. Remove AsyncInputChannel and session state machine.

## Acceptance criteria

- [ ] Mobile `session/prompt` is forwarded to ACPX with sessionId added
- [ ] ACPX `session/update` notifications are forwarded to mobile
- [ ] ACPX prompt result is forwarded to mobile
- [ ] Mobile `session/cancel` is forwarded to ACPX
- [ ] Mode check rejects prompts when `mode === "voice"`
- [ ] Each room has its own ACPX subprocess and ACP session
- [ ] Old custom RPC methods (session/new, session/message, session/resume, session/list) are removed
- [ ] Integration test: mock ACPX subprocess + mock LiveKit room → full round-trip

## What the relay does NOT do

- Parse or interpret ACP content (opaque forwarding)
- Store conversation history (ACPX/OpenClaw handles it)
- Define its own RPC methods (uses ACP vocabulary)

# Task 064a: RoomManager Multi-Topic Support

**Epic:** 04 — Ganglia / Brain Plugin
**Status:** [x]
**Depends on:** none
**Blocks:** 064b, 064d

## Goal

Extend the relay's `RoomManager` to support per-topic data channel handler registration and topic-aware publishing. Currently `RoomManager` is hardcoded to the `"relay"` topic — this change generalizes it so the relay can handle multiple data channel topics (needed for `voice-acp`).

## Context

`RoomManager` (`apps/relay/src/livekit/room-manager.ts`) manages LiveKit room connections and data channel communication. Today it:

- **Receive:** Filters `DataReceived` events to `topic === "relay"` only (line 94). All other topics are silently dropped.
- **Send:** `sendToRoom()` hardcodes `topic: "relay"` (line 172).
- **Handlers:** `onDataReceived(handler)` registers a global handler with no topic filtering.

For task 064 (relay-mediated LLM), the relay needs to also handle `"voice-acp"` messages from the voice-agent. Rather than special-casing another topic, we generalize the mechanism.

```
BEFORE:
  DataReceived → topic === "relay"? → fire all handlers
  sendToRoom() → always topic "relay"

AFTER:
  DataReceived → lookup handlers by topic → fire matching handlers
  sendToRoomOnTopic(room, topic, msg) → publish on specified topic
  sendToRoom(room, msg) → publish on "relay" (backward compat)
```

**Existing callers to update:**
- `RelayBridge.start()` calls `roomManager.onDataReceived(handler)` — update to `onDataReceived("relay", handler)`
- `RelayBridge.forwardToMobile()` calls `roomManager.sendToRoom(roomName, msg)` — no change needed (stays as convenience method)

## Implementation

### 1. Add per-topic handler registration (`apps/relay/src/livekit/room-manager.ts`)

Replace the flat `dataHandlers: DataHandler[]` array with a `Map<string, DataHandler[]>` keyed by topic.

```typescript
// BEFORE
private dataHandlers: DataHandler[] = [];

// AFTER
private topicHandlers = new Map<string, DataHandler[]>();
```

Update `onDataReceived` signature:

```typescript
// BEFORE
onDataReceived(handler: DataHandler): void

// AFTER
onDataReceived(topic: string, handler: DataHandler): void
```

Update the `DataReceived` listener in `joinRoom()` to dispatch by topic:

```typescript
room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
  if (!topic) return;
  const handlers = this.topicHandlers.get(topic);
  if (!handlers?.length) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload).toString("utf-8"));
  } catch {
    return;
  }

  const identity = participant?.identity ?? "unknown";
  for (const handler of handlers) {
    handler(roomName, parsed, identity);
  }
});
```

### 2. Add topic-aware publish (`apps/relay/src/livekit/room-manager.ts`)

Add `sendToRoomOnTopic()` method:

```typescript
async sendToRoomOnTopic(roomName: string, topic: string, msg: object): Promise<void> {
  const conn = this.rooms.get(roomName);
  if (!conn) throw new Error(`Not connected to room: ${roomName}`);

  const data = Buffer.from(JSON.stringify(msg));
  await conn.room.localParticipant!.publishData(data, {
    reliable: true,
    topic,
  });
  conn.lastActivity = Date.now();
}
```

Keep `sendToRoom()` as a convenience that delegates to `sendToRoomOnTopic(roomName, "relay", msg)`.

### 3. Update existing callers

- `RelayBridge.start()`: Change `roomManager.onDataReceived(handler)` to `roomManager.onDataReceived("relay", handler)`.
- Verify no other callers of `onDataReceived` exist (Grep for it).

## Not in scope

- Adding the `voice-acp` topic handler itself — that's task 064b
- Unsubscribe mechanism for topic handlers — not needed (handlers live for the bridge lifetime)

## Relates to

- [064 — Relay-Mediated LLM Backend](064-relay-llm-backend.md) (parent design doc)
- [064b — RelayBridge Voice-ACP Handler](064b-relay-bridge-voice-acp.md) (first consumer of multi-topic)

## Acceptance criteria

- [x] `onDataReceived(topic, handler)` registers a handler for a specific topic
- [x] `DataReceived` events are dispatched only to handlers registered for that topic
- [x] `sendToRoomOnTopic(roomName, topic, msg)` publishes on the specified topic
- [x] `sendToRoom(roomName, msg)` still works as before (convenience for "relay" topic)
- [x] Existing `RelayBridge` caller updated to `onDataReceived("relay", handler)`
- [x] **Test T1:** Register handler for "voice-acp", fire DataReceived with matching topic → handler called
- [x] **Test T2:** Register handler for "voice-acp", fire DataReceived with "relay" topic → handler NOT called
- [x] **Test T3:** `sendToRoomOnTopic` calls `publishData` with correct topic parameter

<!--
Status key:
  [ ]  pending
  [~]  in progress
  [x]  done
  [!]  failed / blocked
-->

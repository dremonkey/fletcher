# Task 081: Session Key Schema + Client→Relay Protocol

**Epic:** 25 — Session Resumption
**Status:** [ ]
**Depends on:** none
**Blocks:** 077 (resume last session), 080 (session browsing)

## Goal

Design and implement the mechanism by which the mobile client specifies which
OpenClaw session key the relay should use, replacing the current room-name-based
derivation. This decouples session identity from room identity, enabling both
session resumption (same key across rooms) and future multi-session support
(multiple keys per user).

## Context

### The current coupling

The relay hardcodes the session key from the room name:

```
  relay-bridge.ts:107
    `agent:main:relay:${options.roomName}`
```

Rooms are disposable transport — the mobile app gets a new random room name on
every reconnect. This means new room = new OpenClaw thread = blank conversation.

### Why not just use participant identity

The obvious fix is `agent:main:relay:<participantIdentity>`, but that creates a
1:1 mapping: one identity = one conversation forever. No "new session" possible.

### What we need

```
  CURRENT:
    relay derives key = f(roomName)
    client has no control

  AFTER:
    client owns the key
    client tells relay which key to use
    relay passes it through to --session
```

### Timing constraint

```
  [Mobile]                    [LiveKit]              [Relay]
     |                           |                      |
     |-- room.connect() ------->|                      |
     |                           |-- webhook ---------->|
     |                           |              addRoom(roomName)
     |                           |              new RelayBridge(...)    ← --session set HERE
     |                           |              bridge.start()
     |                           |              Bun.spawn(openclaw acp --session ...)
     |                           |                      |
     |-- data channel msg ----->|--------------------->|
```

The `--session` flag is baked in at `RelayBridge` construction, which happens
in `addRoom()` triggered by the webhook. The webhook fires *after* the mobile
has joined the room. The webhook payload includes `event.participant.identity`
and `event.participant.metadata`.

### Approaches considered

**A) Participant metadata (recommended):**
Mobile sets participant metadata with the desired session key before or during
connect. The relay reads it from `event.participant.metadata` in the webhook
handler and passes it to `RelayBridge`. LiveKit delivers metadata reliably as
part of the participant join event.

```dart
  // Mobile: set metadata before connect
  final meta = jsonEncode({"sessionKey": "agent:main:relay:device-XYZ:conv-1"});
  await room.connect(url, token, connectOptions: ConnectOptions(
    // metadata is set via the token, not ConnectOptions
  ));
```

Note: Participant metadata is typically set via the token (server-side) or via
`localParticipant.setMetadata()` after connect. If set via token, the token
server needs to accept a `sessionKey` param. If set after connect, there's a
race with the webhook.

**B) Data channel handshake:**
Mobile sends a `session/bind` message as its first data channel message.
Relay defers ACP spawn until it receives the bind message. Adds latency
(relay waits for client) but is clean and explicit.

**C) HTTP param on token request:**
Mobile passes `sessionKey` as a query param to `GET /token`. Token server
embeds it in participant metadata. Relay reads from webhook. Clean but
requires token server changes.

**D) Room metadata:**
Mobile sets room metadata. Relay reads it. But room metadata is shared
and mutable — not ideal for per-participant session binding.

## Implementation

### 1. Session key format

```
  agent:main:relay:<participantIdentity>:<conversationId>

  Examples:
    agent:main:relay:device-abc123:default    (first/default conversation)
    agent:main:relay:device-abc123:conv-2     (second conversation)
    agent:main:relay:device-abc123:1710523200 (timestamp-based ID)
```

The `conversationId` is opaque to the relay — it just passes the full key
through. The mobile app generates and manages conversation IDs.

For TASK-077 (resume), the mobile only ever uses one conversation ID (e.g.,
`default`). TASK-080 (browsing) adds the ability to create/switch IDs.

### 2. Choose communication mechanism

**Decision needed:** How does the client tell the relay which session key to use?
See approaches A-D above. The choice affects timing, complexity, and which
components need changes.

### 3. Relay: accept client-specified session key

In `webhook.ts`, extract the session key from whatever mechanism is chosen
and pass it to `addRoom()`. In `bridge-manager.ts`, thread it to
`RelayBridge`. In `relay-bridge.ts`, use the client-specified key instead
of deriving from room name.

```typescript
  // relay-bridge.ts (after)
  constructor(private options: RelayBridgeOptions) {
    const sessionKey = options.sessionKey   // client-specified
      ?? `agent:main:relay:${options.roomName}`;  // fallback

    this.acpClient = new AcpClient({
      command: options.acpCommand,
      args: [...(options.acpArgs ?? []), "--session", sessionKey],
      ...
    });
  }
```

### 4. Mobile: generate and store session key

```dart
  class SessionKeyManager {
    static const _keyPref = 'fletcher_session_key';

    /// Get or create the current session key
    static Future<String> getCurrentKey(String deviceId) async {
      final prefs = await SharedPreferences.getInstance();
      final stored = prefs.getString(_keyPref);
      if (stored != null) return stored;

      // First time: create default session
      final key = 'agent:main:relay:$deviceId:default';
      await prefs.setString(_keyPref, key);
      return key;
    }
  }
```

### 5. Fallback behavior

If the relay cannot determine a client-specified session key (e.g., no
metadata, old client version), fall back to the current room-name-based key
with a warning log. This maintains backward compatibility.

## Acceptance criteria

- [ ] Session key format documented and agreed
- [ ] Client-to-relay communication mechanism chosen and implemented
- [ ] Relay accepts client-specified session key
- [ ] Relay falls back to room-name-based key with warning if client key absent
- [ ] Mobile generates and stores session key
- [ ] Same session key is sent across multiple room reconnects
- [ ] Different conversation IDs produce different OpenClaw threads (verified with session/load)

## Open questions

1. Which communication mechanism (A/B/C/D)? Recommendation: **B (data channel
   handshake)** — most explicit, no token server changes, clean separation of
   concerns. The latency cost (~50ms) is negligible given session/load is <100ms.
   But if we already need token server changes for other reasons, **C (HTTP param)**
   is cleaner.

2. Should the `conversationId` be human-readable (e.g., `default`, `conv-2`) or
   opaque (timestamp, UUID)? Recommendation: timestamp-based for uniqueness,
   with `default` as the special first-conversation sentinel.

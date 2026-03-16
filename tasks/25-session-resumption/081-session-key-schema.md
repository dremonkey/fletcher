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

### Approach: Data channel handshake (`session/bind`)

The session key is an application-level concern — it belongs in the Fletcher
protocol between mobile and relay, not in LiveKit transport (tokens, metadata).

Alternatives considered and rejected:
- **Participant metadata** — race condition (webhook fires before `setMetadata()`)
  and ties application state to LiveKit transport layer.
- **HTTP param on token request** — couples session identity to auth tokens,
  meaning a new token (and possibly new room connection) is needed just to switch
  conversations. Wrong layer.
- **Room metadata** — shared/mutable, not ideal for per-participant binding.

**Chosen: Data channel handshake.** Mobile sends `session/bind` as its first
data channel message. Relay defers ACP spawn until it receives the bind.

```
  [Mobile]                    [LiveKit]              [Relay]
     |                           |                      |
     |-- room.connect() ------->|                      |
     |                           |-- webhook ---------->|
     |                           |              addRoom(roomName)
     |                           |              joinRoom (relay joins)
     |                           |              WAIT for session/bind ← NEW
     |                           |                      |
     |-- session/bind ---------->|--------------------->|
     |   {sessionKey: "..."}     |              RelayBridge(sessionKey)
     |                           |              bridge.start()
     |                           |              Bun.spawn(openclaw acp --session ...)
     |                           |                      |
     |-- session/prompt -------->|--------------------->|
```

Latency cost is ~50ms (one data channel round trip) — negligible given
session/load itself is <100ms. And it enables session switching later (TASK-080)
by just sending another `session/bind` without reconnecting.

## Implementation

### 1. Naming scheme: shared word pair, different suffixes

Room names and session names share a random word pair from the existing
`RoomNameGenerator` word lists (adjective-noun, ~10,000+ combos). The suffix
distinguishes them:

```
  Word pair: "singing-triforce"

  Room name (disposable transport):
    singing-triforce-4abc           (word pair + 4-char alphanumeric)
    singing-triforce-9f2e           (new room on reconnect, same session)

  Session name (durable conversation):
    singing-triforce-20260316       (word pair + YYYYMMDD)
```

This gives:
- **Human-readable session names** — presentable in TASK-080's session browser
- **Debuggable correlation** — "singing-triforce" links rooms to their session
- **Date-namespaced uniqueness** — same word pair on different days = different
  sessions. Same-day collision is astronomically unlikely (~1 in 10,000); if it
  happens, regenerate the word pair and retry.

### 2. Session key format

The full `--session` key passed to OpenClaw ACP:

```
  agent:main:relay:<sessionName>

  Examples:
    agent:main:relay:singing-triforce-20260316
    agent:main:relay:jade-beacon-20260317
```

The key is opaque to both the relay and OpenClaw — they just pass it through.
The mobile app generates and manages session names.

For TASK-077 (resume), the mobile stores the current session name and reuses it.
TASK-080 (browsing) adds the ability to create new sessions and switch.

### 3. Data channel `session/bind` message

```json
{
  "jsonrpc": "2.0",
  "method": "session/bind",
  "id": 1,
  "params": { "sessionKey": "agent:main:relay:singing-triforce-20260316" }
}
```

Response (after ACP subprocess is ready):
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "sessionKey": "agent:main:relay:singing-triforce-20260316", "bound": true }
}
```

### 4. Relay: defer ACP spawn until `session/bind`

In `bridge-manager.ts`, `addRoom()` joins the room and registers data channel
handlers but does NOT spawn `RelayBridge` yet. When `session/bind` arrives,
the relay creates the `RelayBridge` with the client-specified key and starts it.

```typescript
  // bridge-manager.ts (after)
  async addRoom(roomName: string): Promise<void> {
    await this.roomManager.joinRoom(roomName);
    // Register handler for session/bind — bridge created on bind
    this.roomManager.onDataMessage(roomName, (msg) => {
      if (msg.method === "session/bind") {
        this.bindSession(roomName, msg.params.sessionKey);
      }
    });
  }

  private async bindSession(roomName: string, sessionKey: string): Promise<void> {
    const bridge = new RelayBridge({ roomName, sessionKey, ... });
    this.bridges.set(roomName, bridge);
    await bridge.start();
  }
```

### 5. Relay: accept client-specified session key

In `relay-bridge.ts`, use the client-specified key directly:

```typescript
  // relay-bridge.ts (after)
  constructor(private options: RelayBridgeOptions) {
    const sessionKey = options.sessionKey   // from session/bind
      ?? `agent:main:relay:${options.roomName}`;  // fallback (old clients)

    this.acpClient = new AcpClient({
      command: options.acpCommand,
      args: [...(options.acpArgs ?? []), "--session", sessionKey],
      ...
    });
  }
```

### 6. Mobile: refactor name generator + generate session names

Refactor `RoomNameGenerator` to expose the shared word pair, then build
session names and room names from it:

```dart
  class NameGenerator {
    /// Generate a random word pair (adjective-noun)
    static String generateWordPair() => '${_randomAdj()}-${_randomNoun()}';

    /// Room name: word pair + 4-char alphanumeric (disposable)
    static String generateRoomName() {
      final pair = generateWordPair();
      final suffix = _random4CharAlphanumeric();
      return '$pair-$suffix';
    }

    /// Session name: word pair + YYYYMMDD (durable)
    static String generateSessionName() {
      final pair = generateWordPair();
      final date = DateFormat('yyyyMMdd').format(DateTime.now());
      return '$pair-$date';
    }
  }
```

### 7. Mobile: store and send session key

```dart
  class SessionKeyManager {
    static const _keyPref = 'fletcher_session_key';
    static const _prefix = 'agent:main:relay:';

    /// Get stored session key, or create a new one
    static Future<String> getCurrentKey() async {
      final prefs = await SharedPreferences.getInstance();
      final stored = prefs.getString(_keyPref);
      if (stored != null) return stored;

      final key = '$_prefix${NameGenerator.generateSessionName()}';
      await prefs.setString(_keyPref, key);
      return key;
    }

    /// Create a new session (for TASK-080 "new conversation")
    static Future<String> createNewSession() async {
      final prefs = await SharedPreferences.getInstance();
      final key = '$_prefix${NameGenerator.generateSessionName()}';
      await prefs.setString(_keyPref, key);
      return key;
    }
  }
```

### 8. Mobile: send `session/bind` on connect

After room connect succeeds and data channel is open, send `session/bind`
as the first message before any `session/prompt`:

```dart
  // In LiveKitService, after successful room connect
  final sessionKey = await SessionKeyManager.getCurrentKey();
  _sendDataChannelMessage({
    "jsonrpc": "2.0",
    "method": "session/bind",
    "id": _nextId(),
    "params": {"sessionKey": sessionKey},
  });
  // Wait for bind response before sending prompts
```

### 9. Fallback behavior

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

## Decisions

1. **Communication mechanism: data channel handshake (`session/bind`).** Session
   keys are application-level state, not transport-level. Keeping them in the
   Fletcher data channel protocol (not in tokens or LiveKit metadata) means
   session switching works without reconnecting.

2. **Naming scheme: shared word pair with different suffixes.** Room names and
   session names share a random `adjective-noun` pair from `RoomNameGenerator`
   word lists. Room suffix is 4-char alphanumeric (disposable). Session suffix
   is `YYYYMMDD` (durable, date-namespaced). Human-readable, debuggable, and
   presentable in session browser UI.

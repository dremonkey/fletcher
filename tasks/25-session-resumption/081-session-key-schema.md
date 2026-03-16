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

## Not in scope

- **Old-client fallback** — no old clients; mono-repo ships mobile + relay together
- **Session switching mid-connection** (TASK-080) — deferred
- **`session/load` integration** — that's TASK-077
- **SQLite persistence** — SharedPreferences sufficient for one session key
- **Separate `SessionKeyManager` class** — merged into `SessionStorage` (review decision 2A)

## Implementation

### 1. Naming scheme: shared word pair, different suffixes

Refactor `RoomNameGenerator` → `NameGenerator` (`apps/mobile/lib/utils/room_name_generator.dart`).
Keep existing word lists. Expose shared word pair, then build session + room names:

```
  Word pair: "singing-triforce"

  Room name (disposable transport):
    singing-triforce-4abc           (word pair + 4-char alphanumeric)

  Session name (durable conversation):
    singing-triforce-20260316       (word pair + YYYYMMDD)
```

```dart
  abstract final class NameGenerator {
    static final _random = Random();
    // ... existing word lists ...

    /// Generate a random word pair (adjective-noun)
    static String generateWordPair() {
      final adj = _adjectives[_random.nextInt(_adjectives.length)];
      final noun = _nouns[_random.nextInt(_nouns.length)];
      return '$adj-$noun';
    }

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

    static String _random4CharAlphanumeric() {
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      return List.generate(4, (_) => chars[_random.nextInt(chars.length)]).join();
    }
  }
```

Update all imports: `RoomNameGenerator.generate()` → `NameGenerator.generateRoomName()`.

### 2. Session key format

The full `--session` key passed to OpenClaw ACP:

```
  agent:main:relay:<sessionName>

  Examples:
    agent:main:relay:singing-triforce-20260316
    agent:main:relay:jade-beacon-20260317
```

The key is opaque to both the relay and OpenClaw — they just pass it through.

### 3. Mobile: session key persistence in SessionStorage

Add to `SessionStorage` (`apps/mobile/lib/services/session_storage.dart`):

```dart
  static const _keySessionKey = 'fletcher_session_key';
  static const _sessionKeyPrefix = 'agent:main:relay:';

  /// Get stored session key, or create a new one.
  static Future<String> getSessionKey() async {
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getString(_keySessionKey);
    if (stored != null) return stored;

    final key = '$_sessionKeyPrefix${NameGenerator.generateSessionName()}';
    await prefs.setString(_keySessionKey, key);
    return key;
  }

  /// Create a new session key (for TASK-080 "new conversation").
  static Future<String> createNewSessionKey() async {
    final prefs = await SharedPreferences.getInstance();
    final key = '$_sessionKeyPrefix${NameGenerator.generateSessionName()}';
    await prefs.setString(_keySessionKey, key);
    return key;
  }
```

### 4. Data channel `session/bind` message

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

### 5. Relay: defer ACP spawn + 30s bind timeout

In `bridge-manager.ts`, split `addRoom()` into join + wait:

```
  addRoom(roomName)
    ├── joinRoom(roomName)
    ├── register "relay" topic handler for session/bind
    ├── start 30s bind timeout
    │     └── on timeout: leaveRoom + log warning
    └── track room as "pending bind" (joined but no bridge)

  handleSessionBind(roomName, sessionKey, msgId)
    ├── clear bind timeout
    ├── create RelayBridge({ roomName, sessionKey, ... })
    ├── bridge.start()
    ├── bridges.set(roomName, bridge)
    └── send session/bind response to mobile
```

State machine for a room:
```
  ┌──────────┐   addRoom()    ┌──────────────┐  session/bind  ┌────────┐
  │  absent   │ ─────────────▶ │ pending_bind │ ──────────────▶ │ bound  │
  └──────────┘                └──────────────┘                └────────┘
                                     │                              │
                                     │ 30s timeout                  │ removeRoom()
                                     ▼                              ▼
                              ┌──────────────┐                ┌────────┐
                              │   cleaned up │                │ removed│
                              └──────────────┘                └────────┘
```

Edge cases:
- **prompt before bind** — relay checks `bridges.has(roomName)`. If no bridge,
  respond with JSON-RPC error `{ code: -32011, message: "Session not bound" }`
- **duplicate bind** — idempotent: if bridge exists, respond with current key
- **bind timeout** — 30s timer; on fire: leaveRoom, delete pending state, log warning

### 6. Relay: accept client-specified session key

In `relay-bridge.ts`, add `sessionKey` to `RelayBridgeOptions`:

```typescript
  export interface RelayBridgeOptions {
    roomName: string;
    sessionKey: string;           // ← NEW: from session/bind
    roomManager: RoomManager;
    acpCommand: string;
    acpArgs?: string[];
    logger?: Logger;
  }
```

Use it directly in the constructor:

```typescript
  constructor(private options: RelayBridgeOptions) {
    // ...
    this.acpClient = new AcpClient({
      command: options.acpCommand,
      args: [
        ...(options.acpArgs ?? []),
        "--session",
        options.sessionKey,       // ← was: `agent:main:relay:${options.roomName}`
      ],
      logger: this.log.child({ component: "acp" }),
    });
  }
```

### 7. Mobile: send `session/bind` on connect

In `LiveKitService`, after room connect and data channel ready, send
`session/bind` as the first message before any `session/prompt`:

```dart
  // In connect(), after room.connect() succeeds
  final sessionKey = await SessionStorage.getSessionKey();
  await _publishOnRelay({
    "jsonrpc": "2.0",
    "method": "session/bind",
    "id": _nextBindId(),
    "params": {"sessionKey": sessionKey},
  });
  // RelayChatService should not send prompts until bind response received
```

Gate `RelayChatService.sendPrompt()` behind a bind-complete flag so the user
can't fire a prompt before the session is bound.

## Acceptance criteria

- [ ] `NameGenerator` produces room names (`adj-noun-4chr`) and session names (`adj-noun-YYYYMMDD`)
- [ ] `SessionStorage.getSessionKey()` returns stored key or generates new one
- [ ] Mobile sends `session/bind` as first data channel message after room connect
- [ ] Relay defers ACP spawn until `session/bind` received
- [ ] Relay creates RelayBridge with client-specified sessionKey
- [ ] 30s bind timeout cleans up room if no bind arrives
- [ ] `session/prompt` before bind returns JSON-RPC error
- [ ] Duplicate `session/bind` is idempotent
- [ ] Same session key persists across room reconnects
- [ ] Relay tests: bind success, bind timeout, prompt-before-bind, duplicate bind (~8-10 tests)
- [ ] Mobile tests: NameGenerator format, SessionStorage key persistence (~5 tests)

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

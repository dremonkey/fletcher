# Task 077: Resume Current Session on Reconnect

**Epic:** 25 — Session Resumption
**Status:** [ ]
**Depends on:** 079 (think/final tag parsing — needed for clean replay rendering)
**Blocks:** 080 (session browsing)

## Goal

When a user reconnects after a disconnect (backgrounding, network loss, hold
timeout), restore the conversation transcript from the server via `session/load`
so the user picks up where they left off.

## Context

### The coupling problem

The relay currently binds session key to room name:

```
  relay-bridge.ts:107
    `agent:main:relay:${options.roomName}`
```

This means **new room = new OpenClaw thread = blank conversation**. But rooms
are disposable transport — the mobile app gets a new room on every reconnect.
For resumption, the same OpenClaw thread must be used across rooms.

### What needs to change

```
  CURRENT:
    Room "fletcher-abc123" → --session agent:main:relay:fletcher-abc123
    Room "fletcher-def456" → --session agent:main:relay:fletcher-def456
    (different rooms = different conversations)

  AFTER:
    Room "fletcher-abc123" → --session agent:main:relay:device-XYZ
    Room "fletcher-def456" → --session agent:main:relay:device-XYZ
    (same participant = same conversation, regardless of room)
```

The participant identity (`device-<ANDROID_ID>`) is already stable across
reconnects and app restarts (see `docs/architecture/session-routing.md`).

### What already works (spike TASK-075 confirmed)

- `session/load` replays full conversation (user + agent turns, <100ms)
- Cross-process persistence works (fresh ACP subprocess, same `--session` key)
- Relay already has `session/load` wiring for BUG-022 catch-up
- Mobile already uses stable hardware identity

## Implementation

### 1. Relay: derive session key from participant identity

In `relay-bridge.ts`, change the `--session` arg to use participant identity
instead of room name. The relay learns participant identity when the first
human participant joins the room (via `RoomManager`).

```
  BEFORE: `agent:main:relay:${options.roomName}`
  AFTER:  `agent:main:relay:${participantIdentity}`
```

The `RelayBridge` constructor or `start()` method needs the participant
identity passed in. `BridgeManager.addRoom()` should resolve it from the
room's participant list (via `RoomManager`).

Fallback: if no human participant is found yet (race condition on join),
fall back to room name and log a warning. Update when the participant
arrives.

### 2. Mobile: request session/load on reconnect

After the mobile client reconnects to a new room and the relay bridge is
established, the mobile should send a `session/load` request via data
channel. The relay already handles this for BUG-022 — extend it so the
mobile can explicitly request it.

Data channel message:
```json
{
  "jsonrpc": "2.0",
  "method": "session/load",
  "id": 1,
  "params": { "sessionId": "<current-session-id>" }
}
```

The relay forwards this to `AcpClient.sessionLoad()` and streams the
replayed `session/update` notifications back to mobile.

### 3. Mobile: populate transcript from replay

When the mobile receives `session/update` notifications from a load replay,
it should populate the transcript the same way it handles live updates —
but marked as historical (not triggering "new message" animations or
auto-scroll interruption).

The `user_message_chunk` updates need the OpenClaw metadata preamble
stripped (sender JSON, timestamp, cwd envelope). The `agent_message_chunk`
updates need `<think>`/`<final>` tag parsing (TASK-079).

### 4. Mobile: persist session awareness

The mobile app should remember that it has an active session (just the
session key, not the full transcript). On reconnect, it knows to request
`session/load` rather than starting fresh.

Store in `SharedPreferences` (already used for mute/TTS prefs):
- `session_key` — the identity-based key (e.g., `device-XYZ`)
- `last_session_id` — the ACP sessionId from the last connection

## Acceptance criteria

- [ ] Relay derives `--session` flag from participant identity, not room name
- [ ] Same participant reconnecting to a new room gets the same OpenClaw conversation
- [ ] Mobile requests session/load on reconnect and populates transcript
- [ ] User sees their previous conversation after a background disconnect + reconnect
- [ ] Historical messages don't trigger new-message auto-scroll or thinking spinner
- [ ] Preamble stripping and think/final parsing applied to replayed messages
- [ ] Fallback to room-based key if participant identity is unavailable (with warning log)

# Task 077: Resume Last Session on Reconnect

**Epic:** 25 — Session Resumption
**Status:** [ ]
**Depends on:** 081 (session key schema — client must be able to specify key to relay), 079 (think/final tag parsing — needed for clean replay rendering)
**Blocks:** 080 (session browsing)

## Goal

When a user reconnects after a disconnect (backgrounding, network loss, hold
timeout), restore the conversation transcript from the server via `session/load`
so the user picks up where they left off.

This task does NOT redesign the session key format or client→relay protocol —
that's TASK-081. This task assumes TASK-081 has landed and focuses on:

1. Storing the last session key on the client
2. Sending it to the relay on reconnect (via whatever protocol 081 established)
3. Requesting session/load and populating the transcript

## Context

### What TASK-081 provides

After TASK-081 ships, the mobile client can specify which session key the relay
should use. The relay no longer derives the key from the room name. This means
reconnecting to a *different* room can resume the *same* OpenClaw conversation.

### What this task adds

```
  TASK-081 gives us:
    Client can tell relay "use this session key"

  TASK-077 adds:
    Client REMEMBERS the last session key
    Client SENDS it on every reconnect
    Client REQUESTS session/load after reconnect
    Client RENDERS the replayed history
```

### What already works (spike TASK-075 confirmed)

- `session/load` replays full conversation (user + agent turns, <100ms)
- Cross-process persistence works (fresh ACP subprocess, same `--session` key)
- Relay already has `session/load` wiring for BUG-022 catch-up

## Implementation

### 1. Mobile: persist last session key

Store in `SharedPreferences` (already used for mute/TTS prefs):
- `fletcher_session_key` — the full session key (e.g., `agent:main:relay:device-XYZ:default`)

Write on first use (if absent, generate default key via SessionKeyManager from
TASK-081). Read on every reconnect.

### 2. Mobile: send session key on reconnect

Using whatever protocol TASK-081 established (data channel handshake,
participant metadata, or HTTP param), send the stored session key to the
relay each time the client connects to a room.

### 3. Mobile: request session/load after reconnect

After the relay bridge is established and data channel is open, send a
`session/load` request:

```json
{
  "jsonrpc": "2.0",
  "method": "session/load",
  "id": 1,
  "params": { "sessionId": "<current-session-id>" }
}
```

The relay forwards this to `AcpClient.sessionLoad()` and streams the replayed
`session/update` notifications back to the mobile.

### 4. Mobile: populate transcript from replay

When the mobile receives `session/update` notifications from a load replay,
populate the transcript the same way it handles live updates — but marked as
historical (not triggering "new message" animations or auto-scroll interruption).

- `user_message_chunk` updates need the OpenClaw metadata preamble stripped
  (sender JSON, timestamp, cwd envelope)
- `agent_message_chunk` updates need `<think>`/`<final>` tag parsing (TASK-079)

### 5. Mobile: detect reconnect vs. first connect

On connect, check if `SharedPreferences` has a stored session key:
- **Has key → reconnect path:** send stored key, request session/load
- **No key → first connect path:** generate new key (via TASK-081 SessionKeyManager),
  store it, send it — no session/load needed (fresh conversation)

## Acceptance criteria

- [ ] Mobile persists last session key in SharedPreferences
- [ ] Same session key is sent to relay across room reconnects
- [ ] Mobile requests session/load on reconnect (not on first connect)
- [ ] User sees their previous conversation after background disconnect + reconnect
- [ ] Historical messages don't trigger new-message auto-scroll or thinking spinner
- [ ] Preamble stripping and think/final parsing applied to replayed messages
- [ ] First-time users get a fresh conversation (no session/load attempt)

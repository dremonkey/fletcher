# Task 080: Session Browsing and Switching

**Epic:** 25 — Session Resumption
**Status:** [ ]
**Depends on:** 081 (session key schema — multi-conversation key format), 077 (resume current session)
**Blocks:** none

## Goal

Let the user browse previous sessions and switch between them via the
`/sessions` slash command. Requires a client-side session index since
OpenClaw's `session/list` RPC is not implemented (TASK-075 spike confirmed).

## Context

### Why client-side

OpenClaw advertises `sessionCapabilities.list` in its initialize response
but returns `-32601 Method not found` when `session/list` is called (tested
with all param variants — empty, cwd, cursor). Until OpenClaw ships the
implementation, we maintain our own session index.

### Session vs Room decoupling

TASK-081 decouples the session key from the room name and establishes a
client-owned key format that supports multiple conversations per identity:

```
  Key format: agent:main:relay:<participantIdentity>:<conversationId>

  Examples:
    agent:main:relay:device-abc123:default    (first/default conversation)
    agent:main:relay:device-abc123:conv-2     (second conversation)
```

TASK-077 uses this to resume the last conversation. This task adds the ability
to create new conversations and switch between existing ones.

### Architecture

```
  /sessions command (TASK-076 slash command infra)
    │
    ├── Client checks local session index
    │   (SharedPreferences or SQLite — list of known session keys)
    │
    ├── Renders SessionCard widgets inline in chat stream
    │   (title, last activity, tap to switch)
    │
    └── On tap:
        ├── Save current session key
        ├── Send "switch session" request to relay
        │   (relay spawns new ACP subprocess with different --session key)
        ├── Relay calls session/load on new session
        └── Mobile clears transcript + populates from replay
```

### Relay changes

The relay needs to support session switching mid-connection:
- Receive a "switch session" request from mobile via data channel
- Shut down the current ACP subprocess
- Spawn a new one with the requested `--session` key
- Call `session/load` and forward the replay

### Session index

The client-side index tracks:
```dart
class SessionRecord {
  final String sessionKey;    // e.g., "agent:main:relay:device-XYZ:conv-1"
  final String? title;        // From session_info_update.title (auto-generated)
  final DateTime createdAt;
  final DateTime lastActivity;
}
```

Storage options:
- **SharedPreferences** — simple, sufficient for <50 sessions
- **SQLite** (TASK-005) — if we want richer queries or >50 sessions

The index is updated whenever:
- A new session is created (add entry)
- A `session_info_update` arrives (update title/lastActivity)
- User explicitly deletes a session (remove entry)

### Migration path

When OpenClaw ships `session/list`, we can:
1. Use it as the primary source, client index as cache
2. Or keep client index and use `session/list` to backfill sessions
   created on other devices

## Implementation

### 1. Session index model + persistence
### 2. `/sessions` command handler (register in CommandRegistry)
### 3. `SessionCard` widget for inline rendering
### 4. Relay: session switch protocol (data channel message)
### 5. Relay: ACP subprocess hot-swap on switch
### 6. "New session" flow (create fresh session key)

## Acceptance criteria

- [ ] `/sessions` shows list of known sessions inline in chat
- [ ] Tapping a session card switches to that conversation
- [ ] Transcript clears and repopulates from session/load replay
- [ ] "New session" creates a fresh conversation
- [ ] Session index persists across app restarts
- [ ] Session titles auto-update from `session_info_update` notifications
- [ ] Switching back to a previous session restores its full history

## Deferred

**Why deferred:** Depends on TASK-081 (session key schema) and TASK-077 (resume)
shipping first. Also a lower priority than core session resumption — browsing is
a power-user feature, resumption is the basic UX fix.

**Revisit when:** TASK-077 is complete AND either (a) OpenClaw ships `session/list`
or (b) users report needing multiple conversations.

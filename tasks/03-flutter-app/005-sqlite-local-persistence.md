# TASK-005: SQLite Local Persistence for Chat Transcript

## Status
- **Status:** Open
- **Priority:** Low
- **Owner:** Unassigned
- **Created:** 2026-03-07

## Bug Reference
- [BUG-016](../../docs/field-tests/20260307-buglog.md) — Mobile chat transcript clears on app restart (identity persists, but UI is empty)

## Problem

Force-quitting the app clears the visible transcript. The agent recognizes the user (stable identity) and potentially remembers context (server-side session), but the user loses their local visual history. `ConversationState` (messages, artifacts) is held in memory only.

## Architecture Note (2026-03-15 plan review)

OpenClaw's ACP protocol supports `session/load`, which replays full session history as `session/update` notifications. The relay already uses this for BUG-022 catch-up. **Session resumption (EPIC-25) will use `session/load` as the primary mechanism for restoring conversation transcripts** — the server is the source of truth.

This makes SQLite an **optimization** rather than a prerequisite for session resumption:
- **Instant display cache:** Show cached transcript immediately while `session/load` fetches from server
- **Offline message queue:** Buffer outgoing messages during network dead zones
- **Artifact storage:** If `session/load` doesn't replay tool call artifacts (pending spike TASK-075)

The spike in EPIC-25 will determine exactly what `session/load` replays, which will clarify SQLite's remaining role.

## Solution

Implement local SQLite persistence using `sqflite` or `drift`:

1. Create a local database for `ConversationMessage` and `Artifact` models
2. Persist messages as they arrive (insert on each transcript/artifact event)
3. On app start / `RoomJoined`, load the last N messages from SQLite into the Bloc state
4. Include room name / session key so transcripts from different sessions don't mix

## Acceptance Criteria
- [ ] Messages persist across app force-quit and restart
- [ ] Artifacts persist across app force-quit and restart
- [ ] Old sessions' messages are kept but separated from new sessions
- [ ] No noticeable performance impact on message insertion

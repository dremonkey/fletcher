# Epic 25: Session Resumption

**Goal:** Allow Fletcher to restore conversation state after a room disconnect -- whether from backgrounding (BUG-034), network loss, or intentional hold/resume cycles -- so the user never has to start over.

## Context

Currently, when the client disconnects from a LiveKit room (background timeout, network loss, user-initiated hold), the visible conversation transcript is lost. Reconnecting starts a fresh room with an empty chat log. However, the actual conversation *state* is preserved -- OpenClaw maintains full conversation history server-side, keyed by `session_key` (which is identity-based, not room-based). When a new room is created with the same participant identity, `resolveSessionKeySimple()` returns the same `SessionKey`, and the backend retrieves the same conversation.

The immediate trigger is BUG-034 (relay background reconnection): when the app is backgrounded long enough to hit the 10-minute session timeout (Epic 9, task 019), the room disconnects cleanly. When the user returns, they get a new room and a blank chat log -- even though the server remembers everything.

### What's already solved

A plan review (2026-03-15) mapped the existing architecture against the session resumption requirements and found that ~60% of the infrastructure already exists:

| Sub-Problem | Current Status |
|------------|----------------|
| Persistent session identity (`SessionKey`) | **Solved** -- identity-based, deterministic across rooms |
| Server-side conversation history | **Solved** -- OpenClaw persists keyed by `session_key: "main"` |
| Session history replay | **Implemented** -- `AcpClient.sessionLoad()` replays history as `session/update` notifications (used by relay for BUG-022 catch-up) |
| Session listing | **Available** -- OpenClaw advertises `sessionCapabilities.list` in ACP initialize |
| Hold mode → agent resume | **Solved** -- `AgentPresenceService` + dispatch endpoint |
| Mute/TTS preferences | **Solved** -- persisted via `SharedPreferences` |
| Client-side transcript | **Gap** -- in-memory only, lost on disconnect |
| Resume-aware bootstrap | **Gap** -- agent always sends fresh greeting |

### Approach: Server-as-Truth via `session/load`

The key insight is that **the relay already calls `session/load`** (for BUG-022 catch-up), which replays the full session history as `session/update` notifications. This same mechanism can serve session resumption:

```
  Mobile reconnects → joins new room → relay auto-joins
  → mobile requests history load via data channel
  → relay calls session/load on ACP subprocess
  → relay forwards replayed session/update to mobile
  → mobile renders the conversation history
```

This means:
- **No client-side persistence needed for transcripts** (server has them)
- **No sync issues** (always loading from source of truth)
- **Multi-device works automatically** (same session key, different device)
- **SQLite** (TASK-005) becomes an optimization (instant display cache, offline queue) rather than a prerequisite

## Remaining Open Questions

These need the spike (TASK-075) to answer:

- **What exactly does `session/load` replay?** Agent messages only? User messages too? Tool calls? Artifacts? The relay currently only processes `agent_message_chunk` updates -- the spike needs to log the full replay.
- **What is the replay latency for long sessions?** A 50-turn session could be 50-100KB of JSON-RPC messages. Is this fast enough to feel instant?
- **Does `session/list` work?** OpenClaw advertises the capability but it hasn't been wired or tested.
- **Does the voice agent need resume-aware bootstrap?** Should the agent say "Welcome back" instead of its full system prompt injection? Or does the existing conversation context make this unnecessary?

## Related Work

- **BUG-034 / TASK-074** (background room disconnect) -- the immediate trigger. Client disconnects on background; this epic covers what happens when they come back.
- **BUG-027** (STT watchdog / hold mode) -- hold/resume cycle also needs session restoration when the hold exceeds room lifetime.
- **Epic 9** (Connectivity & Resilience) -- network-level reconnection within a room's lifetime. This epic handles reconnection *after* the room is gone.
- **Epic 20** (Agent Cost Optimization) -- hold mode (task 011) releases agents. Session resumption brings them back with context.
- **Epic 22** (Dual-Mode Architecture) -- both voice mode and chat mode need session resumption. Both use `session_key` for OpenClaw continuity.
- **Epic 24** (WebRTC ACP Relay) -- relay already supports room rejoin on restart + `session/load` for catch-up.
- **TASK-005** (SQLite persistence) -- becomes an optimization for instant display / offline queue, not a prerequisite.

## UX: Session Switching via Slash Command

Session listing and switching uses a **slash command** (`/sessions`) rather than a dedicated button. Mobile UI real estate is too precious for a rare action — you list sessions once, pick one, and move on.

```
  TEXT INPUT ──▶ starts with "/"? ──▶ YES ──▶ Command Registry
                       │                          │
                       NO                    ┌────┴─────────┐
                       │                     │ /sessions     │ → session/list via relay
                       ▼                     │ /pulse, /bug  │ → (future macros, TASK-022)
                  Send to agent/relay        └────┬─────────┘
                                                  │
                                             Result renders as
                                             tappable inline cards
                                             in chat stream
```

**Flow:**
1. User types `/sessions` in text field (or taps `[SES]` macro when TASK-022 ships)
2. Client intercepts the `/` prefix — does NOT send to agent/relay
3. Client sends `session/list` request to relay via data channel
4. Relay calls ACP `session/list`, returns results
5. Results render as tappable `SessionCard` widgets inline in the chat stream
6. User taps a session → **immediate switch** (disconnect current room, reconnect with that session's key, load history via `session/load`)

**Design decisions:**
- **No confirmation dialog** — typing `/sessions` + tapping is intentional enough. Undo = type `/sessions` again.
- **Slash command system** is reusable infrastructure — backs all macros in TASK-022 (Epic 15).
- **`[SES]` macro** in the 3×3 grid is a one-tap shortcut to the same `/sessions` handler.

## Tasks

- [x] **TASK-075: Spike -- session/load + session/list fidelity** -- Results in `075-spike-results.md`. session/load works great (user+agent turns, <100ms, cross-process). session/list returns Method not found despite being advertised.
- [x] **TASK-076: Client-side slash command interceptor** -- In `sendTextMessage()`, intercept `/`-prefixed input and route to a command registry instead of sending to agent/relay. Ships with `/help` as proof-of-life. This is the foundation for all TASK-022 macros.
- [ ] **TASK-077: `/sessions` command + session list rendering** -- **BLOCKED: session/list not implemented server-side.** Scope reduced: focus on resume-current-session via session/load rather than browse-all-sessions.

Candidate follow-up tasks (informed by spike results):
- Wire `session/load` for transcript replay on reconnect (relay already has this for BUG-022; mobile needs to request it)
- Client-side message parsing: strip OpenClaw metadata preamble from user turns, handle `<think>`/`<final>` tags in agent turns
- Resume-aware bootstrap (agent adjusts greeting on resume)
- `[SES]` macro button in TASK-022 macro grid
- SQLite cache for instant transcript display while server loads (optimization)

## Status

**Epic Status:** [~] IN PROGRESS (spike complete, session/load validated)

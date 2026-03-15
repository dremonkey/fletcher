# Epic 25: Session Resumption

**Goal:** Allow Fletcher to restore conversation state after a room disconnect -- whether from backgrounding (BUG-034), network loss, or intentional hold/resume cycles -- so the user never has to start over.

## Context

Currently, when the client disconnects from a LiveKit room (background timeout, network loss, user-initiated hold), the conversation context is lost. Reconnecting starts a fresh session with no memory of the previous exchange. This is acceptable for v1 -- the voice pipeline works, the relay works, hold mode works -- but it becomes a UX problem as users expect continuity. A 10-minute phone call interrupted by a pocket-dial or a network dead zone should not erase the conversation.

The immediate trigger is BUG-034 (relay background reconnection): when the app is backgrounded long enough to hit the 10-minute session timeout (Epic 9, task 019), the room disconnects cleanly. When the user returns, they get a new room and a blank slate. Hold mode (Epic 20, task 011) has the same shape -- the agent is released, and if the hold exceeds the room's `departure_timeout`, the session is gone.

This epic covers the infrastructure needed to:

1. **Persist enough session state to resume a conversation.** What is the minimal set of data that makes a resumed session feel continuous? Conversation history is the obvious candidate, but TTS position, pending tool calls, and user preferences may matter too.
2. **Reconnect to a room and restore context seamlessly.** The user should not see a "starting new session" state. The agent (or relay) should pick up where it left off.
3. **Handle edge cases.** Session expiry (how stale is too stale?), state conflicts (what if the server-side session diverged?), multi-device (what if the user resumed on a different device?).

## Open Questions

These are not yet scoped. They need spikes or design docs before tasks can be created.

- **Where does session state live?** Options: client-side (Flutter persistent storage), server-side (OpenClaw session + relay state), or hybrid (client stores conversation ID, server stores history). OpenClaw already maintains session state keyed by `session_key` -- can we just reconnect to the same session?
- **What state needs persisting?** Conversation history is stored in OpenClaw. But what about: pending artifacts not yet delivered? TTS playback position? The user's mute/TTS-off preferences (already persisted via SessionStorage)? The relay's ACP subprocess state?
- **How long should sessions be resumable?** Minutes (cover network blips and backgrounding)? Hours (cover putting the phone down and coming back)? Days (cover "continue yesterday's conversation")?
- **Does the voice agent need to know it's resuming vs. starting fresh?** Should the agent say "Welcome back" instead of its bootstrap greeting? Should the system prompt include a summary of prior context?
- **What is the relationship to OpenClaw's session model?** If OpenClaw already persists the full conversation via `session_key`, resumption might be as simple as reconnecting with the same key. But the LiveKit room is gone -- does a new room with the same session key "just work"?
- **How does this interact with hold mode?** Hold mode (task 011) already releases the agent but keeps the room alive for `departure_timeout` (120s). Session resumption extends this to cases where the room itself is gone.

## Related Work

- **BUG-034 / TASK-074** (background room disconnect) -- the immediate trigger. Client disconnects on background; this epic covers what happens when they come back.
- **BUG-027** (STT watchdog / hold mode) -- hold/resume cycle also needs session restoration when the hold exceeds room lifetime.
- **Epic 9** (Connectivity & Resilience) -- network-level reconnection is a precondition. Tasks 004, 005, 007, 017 handle reconnection *within* a room's lifetime. This epic handles reconnection *after* the room is gone.
- **Epic 20** (Agent Cost Optimization) -- hold mode (task 011) is the mechanism that releases agents. Session resumption is the mechanism that brings them back with context.
- **Epic 22** (Dual-Mode Architecture) -- both voice mode and chat mode need session resumption. The relay's ACP session and the voice agent's ACP session both use `session_key` for OpenClaw continuity.
- **Epic 24** (WebRTC ACP Relay) -- the relay already supports room rejoin on restart (task: rejoin rooms on restart). Session resumption extends this to include conversation state.

## Tasks

None yet -- this epic is forward-looking. Tasks will be created when we scope the implementation, likely starting with a spike to answer the open questions above.

Candidate first tasks (not committed):
- Spike: map what state is lost on disconnect vs. what survives in OpenClaw
- Spike: prototype reconnecting to the same `session_key` in a new room
- Design doc: session resumption protocol (client-server handshake)

## Status

**Epic Status:** [ ] PLANNING

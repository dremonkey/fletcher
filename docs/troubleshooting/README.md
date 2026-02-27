# Troubleshooting

## LiveKit Agent Lifecycle Reference

Understanding the lifecycle helps diagnose dispatch and connection issues.

### Server lifecycle

1. **Registration** — The agent process starts and registers with the LiveKit server as an available worker. It reports its capabilities (job type, agent name) and waits on standby. Multiple agent servers automatically exchange availability and capacity information with LiveKit, enabling load balancing.

2. **Dispatch** — When a room is created (or a participant connects, depending on dispatch mode), LiveKit sends a job request to available agent servers. The first available server accepts the job and spawns an isolated subprocess to handle it.

3. **Job execution** — The entry function runs. This is where all agent logic lives (STT/TTS setup, session management, participant interaction).

4. **Session close** — By default, a room is automatically closed when the last non-agent participant leaves. Any remaining agents disconnect. Servers gracefully drain active sessions before shutting down during deployments.

### Job lifecycle (inside the entry function)

The canonical order of operations inside `entry`:

1. **Setup** — Initialize resources (LLM, STT, TTS) before connecting to the room.
2. **`session.start()`** — Create and start the `AgentSession`. This registers event listeners. Must happen before `ctx.connect()` so listeners are ready before room events fire.
3. **`ctx.connect()`** — Join the LiveKit room. Room events (track subscriptions, participant joins) start flowing after this call.
4. **`ctx.waitForParticipant()`** — Block until the first non-agent participant joins. Use this to get participant identity for session context.
5. **Shutdown** — Register cleanup via `ctx.addShutdownCallback()`. Callbacks run after the session closes (10-second timeout by default).

### Dispatch modes

**Auto-dispatch (default):** Agents are dispatched once per room creation. The agent registers as `JT_ROOM` and LiveKit sends it a job whenever any new room is created. No naming or token config required — this is the simplest setup.

**Explicit dispatch:** Setting `agentName` in `ServerOptions` **disables auto-dispatch entirely**. The agent must then be dispatched explicitly via one of:
- `RoomAgentDispatch` embedded in the client access token (creates `JT_PARTICIPANT` jobs)
- `AgentDispatchService` API (programmatic dispatch from your backend)
- SIP dispatch rules (for telephony)

When using explicit dispatch, the job type on both sides must match — if the worker registers as `JT_ROOM` but dispatch creates `JT_PARTICIPANT` jobs (or vice versa), LiveKit silently drops the dispatch.

## Issues

- [Agent registers but never joins a room](./agent-not-dispatched.md) — JT_ROOM / JT_PARTICIPANT job type mismatch

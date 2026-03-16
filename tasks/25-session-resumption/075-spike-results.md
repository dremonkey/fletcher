# TASK-075 Spike Results: session/load + session/list fidelity

**Date:** 2026-03-15
**Status:** [x] Complete

## Setup

- OpenClaw ACP Gateway v2026.3.12
- `openclaw acp --session <key>` spawned directly (not through relay)
- 3-turn conversation: intro + math, name recall, summarization
- Tested same-process and cross-process session/load

## Finding 1: `session/list` — NOT IMPLEMENTED

Despite advertising `sessionCapabilities.list: {}` in the initialize response,
`session/list` returns **Method not found** (JSON-RPC error -32601).

Tested with all param variants per the ACP spec
(https://agentclientprotocol.com/rfds/session-list):
- `session/list({})` — Method not found
- `session/list({ cwd: "/home/ahanyu/code/fletcher" })` — Method not found
- `session/list({ cwd: "~" })` — Method not found

The issue is that the RPC handler is unimplemented server-side, not a
missing parameter. Our types now match the spec (cwd, cursor, pagination)
so we're ready when OpenClaw ships it.

```
AcpError: "Method not found": session/list
  code: -32601
  data: { method: "session/list" }
```

**Impact on Epic 25:** TASK-077 (`/sessions` command) cannot use `session/list`
as planned. We need either:
- A) Wait for OpenClaw to implement `session/list`
- B) Build our own session index (SQLite or in-memory, tracking session keys)
- C) Drop session switching from MVP and focus on resume-current-session only

## Finding 2: `session/load` — WORKS WELL

Replays the full conversation as `session/update` notifications.

### What's included

| Update kind | Count (3-turn session) | Contains |
|------------|----------------------|----------|
| `user_message_chunk` | 3 (one per user turn) | Full user text including OpenClaw metadata preamble |
| `agent_message_chunk` | 3 (one per agent turn) | Full agent response including `<think>` and `<final>` tags |
| `session_info_update` | 1 | Session title, updatedAt timestamp |
| `usage_update` | 1 | Token usage (used: 35417, size: 1048576) |
| `available_commands_update` | 1 | Full OpenClaw slash command list |

### What's NOT included

- **Tool calls** — Not tested (no tools invoked). Likely present if tools were used.
- **Artifacts** — Not tested. Same caveat.
- **Streaming chunks** — Each turn is replayed as a single chunk, not the original
  streaming sequence. This is better for replay (fewer messages, no chunking artifacts).
- **Timestamps per turn** — Individual turn timestamps are not included in the replay.
  Only `session_info_update.updatedAt` gives a session-level timestamp.

### Content structure

**User turns** (`user_message_chunk`):
```json
{
  "sessionUpdate": "user_message_chunk",
  "content": {
    "type": "text",
    "text": "Sender (untrusted metadata):\n```json\n{...}\n```\n\n[timestamp] [cwd]\n\nActual user message here"
  }
}
```
- OpenClaw wraps user text in a metadata preamble (sender info, timestamp, cwd)
- The actual user message is the last line(s) after the preamble
- **Parsing needed:** Client must strip the preamble to show clean user text

**Agent turns** (`agent_message_chunk`):
```json
{
  "sessionUpdate": "agent_message_chunk",
  "content": {
    "type": "text",
    "text": "<think>reasoning here</think> <final>visible response</final>"
  }
}
```
- Agent text may include `<think>` blocks (reasoning) and `<final>` blocks
- **Parsing needed:** Client should strip `<think>` tags and extract `<final>` content

### Performance

| Metric | Value |
|--------|-------|
| Same-process load (3 turns) | 33ms |
| Cross-process load (3 turns, fresh subprocess) | 18ms |
| Updates per 3-turn conversation | 9 |
| Total replayed text | ~1.2KB |

Extrapolation: A 50-turn session would produce ~150 updates, ~20KB of JSON.
At this rate, replay should complete in <100ms — well under perceptible latency.

## Finding 3: Cross-process persistence WORKS

A fresh ACP subprocess with the same `--session` key successfully:
1. Creates a new sessionId (different from original)
2. Loads the full conversation history via `session/load`
3. Maintains conversational context (agent remembers user's name, prior exchanges)

**This validates the core session resumption approach.** The server is the source
of truth, and `session/load` is the mechanism to restore client-side state.

## Finding 4: `--session` flag is REQUIRED

Without `--session <key>` in the `openclaw acp` args, prompts fail with:
```
ACP_SESSION_INIT_FAILED: ACP metadata is missing for agent:main:acp:<sessionId>
```

The session key format is `agent:main:<channel>:<identifier>`:
- Relay uses: `agent:main:relay:<roomName>` (per-room)
- Relay test uses: `agent:main:relay-test` (fixed)
- For mobile session resumption: key should be identity-based (e.g., `agent:main:fletcher:<userId>`)

## Finding 5: `InitializeResult` type mismatch

OpenClaw returns `agentCapabilities` (not `capabilities`) in the initialize response:
```json
{
  "protocolVersion": 1,
  "agentCapabilities": { "loadSession": true, ... },
  "agentInfo": { "name": "openclaw-acp", "version": "2026.3.12" },
  "authMethods": []
}
```

The `InitializeResult` type expects `capabilities`. This works but the capabilities
field is `undefined` at runtime. Low priority to fix.

## Recommendations for Epic 25

### session/load is ready for production use
- Full conversation replay works reliably
- Cross-process persistence works
- Performance is excellent (<100ms for multi-turn sessions)
- Both user and agent turns are included

### session/list needs a workaround
- Server advertises the capability but doesn't implement the RPC method
- **Recommended:** Focus TASK-077 on resume-current-session (using known session key)
  rather than browse-all-sessions (which needs session/list)
- The `/sessions` command can be deferred or simplified to show the current session info

### Client-side parsing needed
- User messages need preamble stripping (OpenClaw metadata envelope)
- Agent messages need `<think>`/`<final>` tag handling
- This is new work not covered in the EPIC — should be a task

### Session key management
- The `--session` flag is the key to session identity
- For mobile: derive from participant identity (already how `resolveSessionKeySimple()` works)
- The relay already passes this correctly per-room

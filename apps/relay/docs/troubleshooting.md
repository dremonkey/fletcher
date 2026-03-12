# Relay Troubleshooting

## OpenClaw returns `end_turn` with no content

**Symptom:** The relay connects to `openclaw acp`, creates a session, sends a prompt, and gets back `{"stopReason":"end_turn"}` with no text content. The session does not appear in `openclaw sessions`.

**Cause:** `openclaw acp` was spawned without a `--session` flag. Without it, the ACP bridge creates a transient session that isn't routed through the gateway's model/completion pipeline. The gateway acknowledges the prompt but never invokes a model.

**Fix:** Pass `--session <key>` when spawning `openclaw acp`:

```bash
# Direct test
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientInfo":{"name":"test","version":"0.1"},"capabilities":{}}}' \
  | openclaw acp --session agent:main:my-test
```

The relay does this automatically:
- CLI test endpoint (`/relay/prompt`): uses `--session agent:main:relay-test`
- Per-room bridge: uses `--session agent:main:relay:<roomName>`

**Verify:** After a successful prompt, `openclaw sessions | grep relay` should show the session.

## `openclaw acp` prints box-drawing / banner text on stdout

**Symptom:** Config warnings or banner art appears in the ACP stdout stream mixed with JSON-RPC responses.

**Cause:** OpenClaw prints startup banners and config warnings to stdout before entering JSON-RPC mode.

**Non-issue:** The `AcpClient` reader silently skips non-JSON lines (`handleLine` catches `JSON.parse` errors and ignores them). No action needed.

## `initialized` notification returns "Method not found"

**Symptom:** stderr shows `Error handling notification { method: 'initialized' } { code: -32601, message: '"Method not found": initialized' }`.

**Cause:** The ACP spec includes an `initialized` notification after the `initialize` handshake. OpenClaw's ACP bridge doesn't implement this method.

**Non-issue:** Since `initialized` is a notification (no `id`), no response is expected. The error is logged on stderr by the OpenClaw process but doesn't affect functionality.

## `session/new` returns "Invalid params"

**Symptom:** Error response with details like `cwd: expected string, received undefined` or `mcpServers: expected array, received undefined`.

**Cause:** OpenClaw's ACP bridge requires `cwd` (string) and `mcpServers` (array) in the `session/new` params, even though they're optional in the ACP spec.

**Fix:** Always include both fields:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/new",
  "params": {
    "cwd": "/home/user/project",
    "mcpServers": []
  }
}
```

## `initialize` returns "Invalid params" about `protocolVersion`

**Symptom:** Error: `protocolVersion: expected number, received undefined`.

**Cause:** The `initialize` request is missing `protocolVersion` in params.

**Fix:** Include `protocolVersion: 1`:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientInfo": { "name": "my-client", "version": "0.1.0" },
    "capabilities": {}
  }
}
```

## `acpx` vs `openclaw acp`

**Distinction:** These are different tools:

| Tool | Role | Transport |
|------|------|-----------|
| `openclaw acp` | ACP **agent** (server) — speaks JSON-RPC over stdio | stdin/stdout |
| `acpx` | ACP **client** — wraps agents, manages sessions/queues | spawns agents internally |

The relay must spawn the **agent** (`openclaw acp`), not the client (`acpx`). Spawning `acpx` as a subprocess will hang because it expects to be the one driving the conversation.

`acpx` internally maps agent names to commands (e.g., `openclaw` -> `openclaw acp`). See `acpx config show` for the mapping.

## Relay hangs on startup / EADDRINUSE

**Symptom:** The relay process hangs or fails with `EADDRINUSE`.

**Cause:** A previous relay instance is still running on the same port.

**Fix:**

```bash
# Check what's using the port
lsof -i :7890

# Kill stale relay processes
pkill -f "bun run.*relay.*index"

# Or use a different port
RELAY_HTTP_PORT=7891 bun run scripts/relay-test.ts "hello"
```

## Debugging the ACP protocol exchange

To see raw JSON-RPC traffic between the relay and `openclaw acp`:

```bash
# OpenClaw's acp-bridge.sh logs all traffic
tail -f /tmp/acp-bridge-*.log

# Or add debug logging to the relay
ACP_DEBUG=1 bun run apps/relay/src/index.ts
```

The log format:
- `[HH:MM:SS.ms -> IN]` — messages sent to the agent (requests)
- `[HH:MM:SS.ms <- OUT]` — messages from the agent (responses/notifications)

# R-002: ACP Client over stdio

**Status:** [x] Complete
**Depends on:** Nothing (can be built and tested independently)
**Blocks:** R-003

## Objective

Implement an ACP client that spawns an ACP agent (e.g., ACPX) as a subprocess and communicates via JSON-RPC 2.0 over stdio. This replaces the mock agent in `src/session/agent-bridge.ts`.

## Background

ACP (Agent Client Protocol) uses JSON-RPC 2.0. The client sends requests, the agent sends responses and notifications. Transport is newline-delimited JSON over stdin/stdout.

Reference: `docs/acp-transport.md`

## What exists

- `src/rpc/types.ts` — JSON-RPC 2.0 types (reusable)
- `src/rpc/errors.ts` — Error codes (reusable)
- `src/session/agent-bridge.ts` — Mock agent (replace)

## What to build

### ACP client

```typescript
interface AcpClient {
  // Lifecycle
  initialize(): Promise<InitializeResult>;
  shutdown(): Promise<void>;

  // Session
  sessionNew(params: SessionNewParams): Promise<SessionNewResult>;
  sessionPrompt(params: SessionPromptParams): Promise<SessionPromptResult>;
  sessionCancel(): void;  // notification, no response

  // Events
  onUpdate(handler: (params: SessionUpdateParams) => void): void;
}
```

### Subprocess management

```typescript
const proc = Bun.spawn([ACP_COMMAND, ...ACP_ARGS], {
  stdin: 'pipe',
  stdout: 'pipe',
  stderr: 'pipe',
});

// Write JSON-RPC to stdin
function send(msg: object) {
  proc.stdin.write(JSON.stringify(msg) + '\n');
}

// Read JSON-RPC from stdout (line-delimited)
// Each line is a complete JSON-RPC message
```

### ACP handshake

On connect, the client sends `initialize`:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "clientInfo": { "name": "fletcher-relay", "version": "0.1.0" },
    "capabilities": {}
  }
}
```

Agent responds with capabilities. Client then sends `initialized` notification to confirm.

### Session creation

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/new",
  "params": {
    "cwd": "/",
    "mcpServers": [],
    "_meta": {
      "session_key": { "type": "owner", "key": "alice" },
      "room_name": "room_abc",
      "participant_identity": "alice"
    }
  }
}
```

Agent responds with `sessionId`.

### Prompt (streaming)

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "session/prompt",
  "params": {
    "sessionId": "sess_abc",
    "prompt": [{ "type": "text", "text": "Hello" }]
  }
}
```

Agent streams `session/update` notifications, then resolves the request with `stopReason`.

## Configuration

```bash
ACP_COMMAND=acpx           # Command to spawn
ACP_ARGS=                  # Optional args (space-separated)
ACP_TRANSPORT=stdio        # stdio (default) or websocket (future)
```

## Acceptance criteria

- [ ] Can spawn an ACP agent subprocess
- [ ] Sends `initialize` and receives capabilities
- [ ] Sends `session/new` with `_meta.session_key` routing metadata
- [ ] Sends `session/prompt` and receives streaming `session/update` notifications
- [ ] Sends `session/cancel` notification
- [ ] Handles subprocess exit/crash gracefully
- [ ] Tests use a mock ACP agent (simple Bun subprocess that speaks JSON-RPC)
- [ ] Existing JSON-RPC types from `src/rpc/types.ts` are reused

## Testing without ACPX

Write a mock ACP agent as a Bun script (`test/mock-acpx.ts`) that reads JSON-RPC from stdin and responds on stdout:

```typescript
// test/mock-acpx.ts — minimal ACP agent for testing
const decoder = new TextDecoder();
for await (const chunk of Bun.stdin.stream()) {
  for (const line of decoder.decode(chunk).split('\n').filter(Boolean)) {
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } }));
    } else if (msg.method === 'session/new') {
      console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'mock-sess-001' } }));
    } else if (msg.method === 'session/prompt') {
      const text = msg.params.prompt?.[0]?.text ?? '';
      // Stream an update notification, then resolve
      console.log(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { updates: [{ kind: 'content_chunk', content: { type: 'text', text: 'Echo: ' + text } }] } }));
      console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'completed' } }));
    }
  }
}
```

Point the relay at it with `ACP_COMMAND="bun" ACP_ARGS="test/mock-acpx.ts"`. This tests the full ACP client lifecycle without needing real ACPX or OpenClaw.

## Notes

- One ACP client per room (each room gets its own ACPX subprocess)
- The relay doesn't interpret ACP content — it forwards opaquely
- The relay DOES manage sessionId (from `session/new` response) and injects it into `session/prompt`

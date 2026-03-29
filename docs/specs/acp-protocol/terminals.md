# Terminals

> Executing and managing terminal commands

Terminal methods allow Agents to execute shell commands within the Client's environment. Requires `clientCapabilities.terminal`.

## Executing Commands

`terminal/create`:

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "terminal/create",
  "params": {
    "sessionId": "sess_abc123def456",
    "command": "npm",
    "args": ["test", "--coverage"],
    "env": [{"name": "NODE_ENV", "value": "test"}],
    "cwd": "/home/user/project",
    "outputByteLimit": 1048576
  }
}
```

Returns a Terminal ID immediately without waiting for completion.

## Methods

- `terminal/create` — Start command, returns `terminalId`
- `terminal/output` — Get current output without waiting
- `terminal/wait_for_exit` — Wait for command to complete
- `terminal/kill` — Terminate command (terminal remains valid)
- `terminal/release` — Kill and release all resources (required cleanup)

## Embedding in Tool Calls

Terminals can be embedded in tool call content:

```json
{
  "type": "terminal",
  "terminalId": "term_xyz789"
}
```

Source: https://agentclientprotocol.com/protocol/terminals

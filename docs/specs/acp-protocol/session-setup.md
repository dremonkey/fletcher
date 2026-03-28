# Session Setup

> Creating and loading sessions

Sessions represent a specific conversation or thread between the Client and Agent. Each session maintains its own context, conversation history, and state, allowing multiple independent interactions with the same Agent.

## Creating a Session

Clients create a new session by calling `session/new`:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "session/new",
  "params": {
    "cwd": "/home/user/project",
    "mcpServers": [
      {
        "name": "filesystem",
        "command": "/path/to/mcp-server",
        "args": ["--stdio"],
        "env": []
      }
    ]
  }
}
```

The Agent **MUST** respond with a unique Session ID:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "sessionId": "sess_abc123def456"
  }
}
```

## Loading Sessions

Agents that support the `loadSession` capability allow Clients to resume previous conversations.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "session/load",
  "params": {
    "sessionId": "sess_789xyz",
    "cwd": "/home/user/project",
    "mcpServers": []
  }
}
```

The Agent **MUST** replay the entire conversation to the Client in the form of `session/update` notifications.

## Working Directory

The `cwd` parameter:
- **MUST** be an absolute path
- **MUST** be used for the session regardless of where the Agent subprocess was spawned
- **SHOULD** serve as a boundary for tool operations on the file system

## MCP Servers

MCP servers can be connected to using different transports:
- **stdio** (required) — All Agents **MUST** support this
- **HTTP** (optional) — Check `mcpCapabilities.http`
- **SSE** (deprecated) — Check `mcpCapabilities.sse`

Source: https://agentclientprotocol.com/protocol/session-setup

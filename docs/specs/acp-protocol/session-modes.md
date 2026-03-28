# Session Modes

> Switch between different agent operating modes

> **Note:** Use Session Config Options instead. Dedicated session mode methods will be removed in a future version.

Agents can provide modes they operate in (e.g., `ask`, `architect`, `code`). Modes affect system prompts, tool availability, and permission behavior.

## Initial State

Returned in `session/new` response as `modes` field with `currentModeId` and `availableModes`.

## Setting Mode

### From Client

`session/set_mode`:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/set_mode",
  "params": {
    "sessionId": "sess_abc123def456",
    "modeId": "code"
  }
}
```

### From Agent

`current_mode_update` via `session/update`:

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def456",
    "update": {
      "sessionUpdate": "current_mode_update",
      "modeId": "code"
    }
  }
}
```

Source: https://agentclientprotocol.com/protocol/session-modes

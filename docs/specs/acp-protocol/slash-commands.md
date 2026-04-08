# Slash Commands

> Advertise available slash commands to clients

Agents can advertise slash commands via `available_commands_update` session notification.

## Advertising Commands

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def456",
    "update": {
      "sessionUpdate": "available_commands_update",
      "availableCommands": [
        { "name": "web", "description": "Search the web for information", "input": { "hint": "query to search for" } },
        { "name": "test", "description": "Run tests for the current project" },
        { "name": "plan", "description": "Create a detailed implementation plan", "input": { "hint": "description of what to plan" } }
      ]
    }
  }
}
```

### AvailableCommand Properties

- `name` (string, required) — Command name (e.g., "web", "test")
- `description` (string, required) — What the command does
- `input` (AvailableCommandInput) — Optional input spec with `hint` field

## Dynamic Updates

The Agent can update commands at any time by sending another `available_commands_update`.

## Running Commands

Commands are included as regular text in `session/prompt`:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "session/prompt",
  "params": {
    "sessionId": "sess_abc123def456",
    "prompt": [{ "type": "text", "text": "/web agent client protocol" }]
  }
}
```

Source: https://agentclientprotocol.com/protocol/slash-commands

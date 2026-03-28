# Agent Plan

> How Agents communicate their execution plans

Plans are execution strategies for complex tasks. Agents share plans via `session/update` notifications.

## Creating Plans

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def456",
    "update": {
      "sessionUpdate": "plan",
      "entries": [
        { "content": "Analyze the existing codebase structure", "priority": "high", "status": "pending" },
        { "content": "Identify components that need refactoring", "priority": "high", "status": "pending" },
        { "content": "Create unit tests for critical functions", "priority": "medium", "status": "pending" }
      ]
    }
  }
}
```

## Plan Entry Properties

- `content` (string, required) — Human-readable description
- `priority` (PlanEntryPriority, required) — `high`, `medium`, `low`
- `status` (PlanEntryStatus, required) — `pending`, `in_progress`, `completed`

## Updating Plans

The Agent **MUST** send a complete list of all plan entries in each update. The Client **MUST** replace the current plan completely.

Plans can evolve during execution — the Agent **MAY** add, remove, or modify entries.

Source: https://agentclientprotocol.com/protocol/agent-plan

# Tool Calls

> How Agents report tool call execution

Tool calls represent actions that language models request Agents to perform during a prompt turn.

## Creating

When the language model requests a tool invocation, the Agent **SHOULD** report it:

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def456",
    "update": {
      "sessionUpdate": "tool_call",
      "toolCallId": "call_001",
      "title": "Reading configuration file",
      "kind": "read",
      "status": "pending"
    }
  }
}
```

**Properties:**
- `toolCallId` (ToolCallId, required) — A unique identifier for this tool call
- `title` (string, required) — A human-readable title describing what the tool is doing
- `kind` (ToolKind) — The category: `read`, `edit`, `delete`, `move`, `search`, `execute`, `think`, `fetch`, `other` (default)
- `status` (ToolCallStatus) — The current execution status (defaults to `pending`)
- `content` (ToolCallContent[]) — Content produced by the tool call
- `locations` (ToolCallLocation[]) — File locations affected by this tool call
- `rawInput` (object) — The raw input parameters sent to the tool
- `rawOutput` (object) — The raw output returned by the tool

## Updating

Updates use `tool_call_update`:

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def456",
    "update": {
      "sessionUpdate": "tool_call_update",
      "toolCallId": "call_001",
      "status": "in_progress",
      "content": [
        {
          "type": "content",
          "content": {
            "type": "text",
            "text": "Found 3 configuration files..."
          }
        }
      ]
    }
  }
}
```

## Requesting Permission

The Agent **MAY** request permission via `session/request_permission`:

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "session/request_permission",
  "params": {
    "sessionId": "sess_abc123def456",
    "toolCall": {
      "toolCallId": "call_001"
    },
    "options": [
      { "optionId": "allow-once", "name": "Allow once", "kind": "allow_once" },
      { "optionId": "reject-once", "name": "Reject", "kind": "reject_once" }
    ]
  }
}
```

Permission option kinds: `allow_once`, `allow_always`, `reject_once`, `reject_always`

## Status

- `pending` — Not started yet
- `in_progress` — Currently running
- `completed` — Completed successfully
- `failed` — Failed with an error

## Content Types

### Regular Content
Standard content blocks like text, images, or resources.

### Diffs
File modifications shown as diffs:

```json
{
  "type": "diff",
  "path": "/home/user/project/src/config.json",
  "oldText": "{\"debug\": false}",
  "newText": "{\"debug\": true}"
}
```

- `path` (string, required) — The absolute file path being modified
- `oldText` (string) — The original content (null for new files)
- `newText` (string, required) — The new content after modification

### Terminals
Live terminal output:

```json
{
  "type": "terminal",
  "terminalId": "term_xyz789"
}
```

## Following the Agent

Tool calls can report file locations they're working with:

```json
{
  "path": "/home/user/project/src/main.py",
  "line": 42
}
```

- `path` (string, required) — The absolute file path
- `line` (number) — Optional line number within the file

Source: https://agentclientprotocol.com/protocol/tool-calls

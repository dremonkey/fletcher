# File System

> Client filesystem access methods

The filesystem methods allow Agents to read and write text files within the Client's environment. These methods enable Agents to access unsaved editor state and allow Clients to track file modifications.

## Checking Support

Check `clientCapabilities.fs.readTextFile` and `clientCapabilities.fs.writeTextFile` during initialization.

## Reading Files

`fs/read_text_file`:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "fs/read_text_file",
  "params": {
    "sessionId": "sess_abc123def456",
    "path": "/home/user/project/src/main.py",
    "line": 10,
    "limit": 50
  }
}
```

- `sessionId` (SessionId, required)
- `path` (string, required) — Absolute path to the file
- `line` (number) — Optional line number to start from (1-based)
- `limit` (number) — Optional max lines to read

## Writing Files

`fs/write_text_file`:

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "fs/write_text_file",
  "params": {
    "sessionId": "sess_abc123def456",
    "path": "/home/user/project/config.json",
    "content": "{\"debug\": true}"
  }
}
```

The Client **MUST** create the file if it doesn't exist.

Source: https://agentclientprotocol.com/protocol/file-system

# Session List

> Discovering existing sessions

The `session/list` method allows Clients to discover sessions known to an Agent. Requires `sessionCapabilities.list` capability.

## Listing Sessions

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/list",
  "params": {
    "cwd": "/home/user/project",
    "cursor": "eyJwYWdlIjogMn0="
  }
}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "sessions": [
      {
        "sessionId": "sess_abc123def456",
        "cwd": "/home/user/project",
        "title": "Implement session list API",
        "updatedAt": "2025-10-29T14:22:15Z"
      }
    ],
    "nextCursor": "eyJwYWdlIjogM30="
  }
}
```

## SessionInfo Properties

- `sessionId` (string, required) — Unique identifier
- `cwd` (string, required) — Working directory (absolute path)
- `title` (string) — Human-readable title
- `updatedAt` (string) — ISO 8601 timestamp of last activity
- `_meta` (object) — Agent-specific metadata

## Pagination

Uses cursor-based pagination. Missing `nextCursor` means end of results.

## Updating Session Metadata

Agents can send `session_info_update` via `session/update` to update title and metadata in real-time.

Source: https://agentclientprotocol.com/protocol/session-list

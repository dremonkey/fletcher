# Extensibility

> Adding custom data and capabilities

## The `_meta` Field

All types include a `_meta` field (`{ [key: string]: unknown }`) for custom information.

Reserved root-level keys for W3C trace context: `traceparent`, `tracestate`, `baggage`.

Implementations **MUST NOT** add custom fields at the root of spec types — all names are reserved.

## Extension Methods

Method names starting with `_` are reserved for custom extensions.

### Custom Requests

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "_zed.dev/workspace/buffers",
  "params": { "language": "rust" }
}
```

Unrecognized methods should return "Method not found" (-32601).

### Custom Notifications

```json
{
  "jsonrpc": "2.0",
  "method": "_zed.dev/file_opened",
  "params": { "path": "/home/user/project/src/editor.rs" }
}
```

Implementations **SHOULD** ignore unrecognized notifications.

## Advertising Custom Capabilities

Use `_meta` in capability objects:

```json
{
  "agentCapabilities": {
    "loadSession": true,
    "_meta": {
      "zed.dev": {
        "workspace": true,
        "fileNotifications": true
      }
    }
  }
}
```

Source: https://agentclientprotocol.com/protocol/extensibility

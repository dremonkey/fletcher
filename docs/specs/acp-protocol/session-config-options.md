# Session Config Options

> Flexible configuration selectors for agent sessions

Agents can provide an arbitrary list of configuration options for a session (models, modes, reasoning levels, etc.). Preferred over the deprecated `modes` API.

## Initial State

Returned in `session/new` response as `configOptions` array.

### ConfigOption Properties

- `id` (string, required) — Unique identifier
- `name` (string, required) — Human-readable label
- `description` (string) — What this option controls
- `category` (ConfigOptionCategory) — Semantic category: `mode`, `model`, `thought_level`
- `type` (ConfigOptionType, required) — Currently only `select`
- `currentValue` (string, required) — Currently selected value
- `options` (ConfigOptionValue[], required) — Available values

## Setting From Client

`session/set_config_option`:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/set_config_option",
  "params": {
    "sessionId": "sess_abc123def456",
    "configId": "mode",
    "value": "code"
  }
}
```

Response always contains the **complete** configuration state (enables dependent changes).

## Setting From Agent

`config_option_update` via `session/update`.

## Option Ordering

The order of the `configOptions` array is significant — higher-priority options first.

Source: https://agentclientprotocol.com/protocol/session-config-options

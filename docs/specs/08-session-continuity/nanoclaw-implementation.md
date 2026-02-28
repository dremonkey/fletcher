# Session Continuity: Nanoclaw Implementation

Implements the session routing contract defined in [spec.md](./spec.md) for the Nanoclaw backend.

## Context

Nanoclaw is a single-user, local-first backend. There is no multi-user auth, no API keys, and no concept of "guests" in the traditional sense. The owner is the only user — Nanoclaw runs on their machine.

This simplifies session routing significantly compared to OpenClaw.

## Session Key Mapping

| Session Type | Mechanism | Value |
|---|---|---|
| Owner (main) | Header: `X-Nanoclaw-Channel` | `"main"` or omitted (default session) |
| Guest | Header: `X-Nanoclaw-Channel` | `"guest:{identity}"` |
| Room (multi-user) | Header: `X-Nanoclaw-Channel` | `"room:{room_name}"` |

### Single-User Simplification

Since Nanoclaw is personal, the common case is **owner solo**. The session routing collapses to:

- Owner connects → use the default session (no special headers needed)
- Anyone else → channel-based isolation

In practice, most Nanoclaw deployments won't need guest or multi-user routing at all. But the mechanism exists for forward compatibility.

## Request Examples

### Owner (Solo) — Default Case

```http
POST /v1/chat/completions HTTP/1.1
Content-Type: application/json

{
  "model": "nanoclaw",
  "messages": [...],
  "stream": true
}
```

No channel header needed. Nanoclaw routes to the default (main) session. All history from CLI, web, and voice sessions is available.

### Owner (Solo) — Explicit Channel

```http
POST /v1/chat/completions HTTP/1.1
X-Nanoclaw-Channel: main
Content-Type: application/json

{
  "model": "nanoclaw",
  "messages": [...],
  "stream": true
}
```

Equivalent to the default case but explicit. Useful if Fletcher always sends a channel header regardless of backend.

### Guest (if supported)

```http
POST /v1/chat/completions HTTP/1.1
X-Nanoclaw-Channel: guest:bob
Content-Type: application/json

{
  "model": "nanoclaw",
  "messages": [...],
  "stream": true
}
```

Creates an isolated channel for Bob. Since Nanoclaw is local, the owner is implicitly trusting anyone on their network.

## Changes to NanoclawClient

The current `nanoclaw-client.ts` generates channel JIDs from `participantIdentity` with a prefix (default `"lk"`) — see [Nanoclaw Integration spec](../04-livekit-agent-plugin/nanoclaw-integration.md) for the existing JID and cross-channel history model. This should be updated to use the resolved `SessionKey`.

### Current flow (to be replaced)

```
generateChannelJid(session, prefix) → "lk:alice"
```

### New flow

```
resolveSessionKey(room, config) → SessionKey { type, key }
                                      ↓
                        ┌─────────────┼──────────────┐
                        │             │              │
                    type: owner   type: guest    type: room
                        │             │              │
                 X-Nanoclaw-   X-Nanoclaw-    X-Nanoclaw-
                 Channel:      Channel:       Channel:
                 "main"        "guest:bob"    "room:standup"
                 (or omit)
```

## Cross-Channel History

Nanoclaw stores all messages in a single SQLite database. Channels provide logical separation, but the owner can query across channels. This means:

- If the owner talks to the agent via CLI and then via voice, the agent has access to both histories (same channel or cross-channel query).
- If a guest talks to the agent, that history is in a separate channel and not mixed into the owner's context.

## Security Model

Nanoclaw has **no authentication**. It runs on localhost and trusts all connections.

- **Owner identity** is still configured in Fletcher for routing purposes, but Nanoclaw does not verify it.
- **Network exposure:** If Nanoclaw is exposed beyond localhost (e.g., via reverse proxy), access control must be handled externally.
- **Guest isolation** is a courtesy, not a security boundary. A guest could theoretically send `X-Nanoclaw-Channel: main` and access the owner's session. For true multi-user security, use OpenClaw.

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `NANOCLAW_URL` | Nanoclaw HTTP endpoint | `http://localhost:18789` |
| `NANOCLAW_CHANNEL_PREFIX` | Prefix for channel JIDs (legacy, may be deprecated) | `"lk"` |
| `FLETCHER_OWNER_IDENTITY` | Participant identity of the owner | (required for routing) |

## Nanoclaw API Prerequisite

Nanoclaw must have the OpenAI-compatible API layer enabled. This is added via the `/add-openai-api` skill in Nanoclaw's configuration. See `docs/specs/04-livekit-agent-plugin/nanoclaw-integration.md` for setup details.

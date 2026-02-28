# Session Continuity: OpenClaw Implementation

Implements the session routing contract defined in [spec.md](./spec.md) for the OpenClaw backend.

## Session Key Mapping

OpenClaw provides two mechanisms for session identity:

| Session Type | Mechanism | Value |
|---|---|---|
| Owner (main) | Header: `x-openclaw-session-key` | `"main"` |
| Guest | Body field: `user` | `"guest_{identity}"` |
| Room (multi-user) | Body field: `user` | `"room_{room_name}"` |

### Why two mechanisms?

- `x-openclaw-session-key: "main"` tells the Gateway to route directly to the owner's primary session — the same one used by CLI, WhatsApp, etc. This header is authenticated; the Gateway only honors it if the request's auth token belongs to the owner.
- `user` creates a derived session keyed to that string. Guests and rooms get their own isolated sessions without needing special auth.

## Request Examples

### Owner (Solo)

```http
POST /v1/chat/completions HTTP/1.1
Authorization: Bearer {OPENCLAW_API_KEY}
x-openclaw-session-key: main
Content-Type: application/json

{
  "model": "openclaw-gateway",
  "messages": [...],
  "stream": true
}
```

The owner's request goes to the "main" session — full memory, history, and SOUL access.

### Guest (Solo)

```http
POST /v1/chat/completions HTTP/1.1
Authorization: Bearer {OPENCLAW_API_KEY}
Content-Type: application/json

{
  "model": "openclaw-gateway",
  "messages": [...],
  "stream": true,
  "user": "guest_bob"
}
```

Bob gets a persistent but isolated session. He can disconnect and reconnect — his conversation resumes. But he cannot see the owner's memory or history.

### Multi-User Room

```http
POST /v1/chat/completions HTTP/1.1
Authorization: Bearer {OPENCLAW_API_KEY}
Content-Type: application/json

{
  "model": "openclaw-gateway",
  "messages": [...],
  "stream": true,
  "user": "room_project-standup"
}
```

All participants in the room share a single session context.

## Changes to OpenClawClient

The current `client.ts` generates session IDs from `roomSid:participantIdentity` (see [brain plugin spec](../04-livekit-agent-plugin/spec.md) for the existing `conversationId` model). This needs to change to use the resolved `SessionKey` from the routing logic.

### Current flow (to be replaced)

```
extractSessionFromContext() → { roomSid, participantIdentity }
generateSessionId() → "RM_abc:alice"
buildSessionHeaders() → X-OpenClaw-Session-Id, X-OpenClaw-Room-SID, etc.
```

### New flow

```
resolveSessionKey(room, config) → SessionKey { type, key }
                                      ↓
                        ┌─────────────┼──────────────┐
                        │             │              │
                    type: owner   type: guest    type: room
                        │             │              │
              header:           body.user:      body.user:
         x-openclaw-      "guest_{id}"    "room_{name}"
         session-key:
            "main"
```

### Backward Compatibility

The existing `X-OpenClaw-*` headers (`Room-SID`, `Room-Name`, `Participant-Identity`, `Participant-SID`) can still be sent as supplementary metadata. They are informational and do not affect routing.

## Security

- The `x-openclaw-session-key: "main"` header is only honored for authenticated requests with a valid owner token. A guest cannot spoof this header.
- Guest sessions are isolated by the Gateway's session policy. Even if a guest guesses another guest's `user` string, the data is scoped to the API key.

## Session Lifecycle in OpenClaw

- **Creation:** Implicit on first request with a new session key.
- **Persistence:** Sessions persist across Gateway restarts (disk-backed).
- **Expiry:** Governed by Gateway config. Sessions may unload from memory but remain on disk.
- **Re-hydration:** When a request arrives for an unloaded session, the Gateway loads history from disk and continues.

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `OPENCLAW_GATEWAY_URL` | Gateway HTTP endpoint | `http://localhost:8080` |
| `OPENCLAW_API_KEY` | Auth token for the Gateway | (required) |
| `FLETCHER_OWNER_IDENTITY` | Participant identity of the owner | (required for routing) |

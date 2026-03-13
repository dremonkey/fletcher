# Fletcher Relay — Architecture

## Problem

Fletcher uses `livekit-agent` for voice. It works well for voice but the billing model makes text-only interactions uneconomical:

- Agent session minutes: **$0.01/min**
- Minimum billing unit: **1 minute per session**
- A 10-second text interaction costs the same as a 60-second voice session

The goal is a text interaction path that bypasses the agent framework entirely.

## Transport Decision: LiveKit Non-Agent Participant

### What we evaluated

| Option | Network resilience | Server complexity | Cost |
|---|---|---|---|
| Raw WebSocket | Poor (TCP drop on network switch) | Low | N/A |
| WebRTC direct (no LiveKit) | Good (ICE restart) | High (native addon in Bun) | N/A |
| **LiveKit non-agent participant** | **Good (ICE restart via LiveKit)** | **Low (rtc-node)** | **$0.0005/min** |

### Why not raw WebSocket

When a mobile device switches WiFi → cellular, the underlying TCP connection dies silently. A WebSocket reconnect requires:

- Re-establishing the transport
- Re-identifying the session (stable session ID needed)
- Replaying missed events (server-side buffering needed)
- Heartbeat/ping-pong to detect stale connections through carrier middleboxes

This is solvable but it's a significant amount of hand-rolled reconnection logic that LiveKit already provides.

### Why LiveKit non-agent participant

The relay connects to LiveKit rooms as a **regular server-side participant** using `@livekit/rtc-node`, not as a deployed cloud agent. Communication happens over a **LiveKit data channel**, which is DTLS/SCTP over WebRTC.

Benefits:
- **ICE restart** — network switches are handled at the WebRTC layer. The data channel session survives without the relay or mobile having to reconnect at the application level.
- **LiveKit handles STUN/TURN** — no separate NAT traversal infrastructure needed.
- **Mobile reuses existing code** — `livekit_client` is already in the Flutter app. The data channel protocol is already implemented.
- **Not an agent** — LiveKit does not charge agent session minutes. Only WebRTC participant minutes apply.

## Economics

LiveKit pricing (as of March 2026):

| Billing type | Rate |
|---|---|
| Agent session minutes | $0.01 / min |
| WebRTC participant minutes | $0.0005 / min |

**Agent vs relay participant for a 10-second text interaction:**

| Path | Billed minutes | Cost |
|---|---|---|
| livekit-agent | 1 min (minimum) | $0.01 |
| Mobile participant (10s) | 0.17 min | $0.000083 |
| Relay participant (10s) | 0.17 min | $0.000083 |
| **Relay path total** | | **~$0.000167** |
| **Savings** | | **~60x** |

For a 2-minute text interaction the savings narrow to ~10x. Voice sessions remain on the agent path where the STT/TTS/VAD bundle justifies the cost.

## Architecture

The relay is an **ACP client** that bridges the LiveKit data channel to an ACP agent (OpenClaw). The voice agent is a separate ACP client that connects to the same ACP agent independently.

```
TEXT PATH (Chat Mode)
─────────────────────
Mobile ──data channel──▶ Relay (Bun, LiveKit participant)
                              │
                              │ ACP (stdio or WebSocket)
                              ▼
                         OpenClaw (ACP agent)

VOICE PATH (Voice Mode)
───────────────────────
Mobile ──audio track──▶ livekit-agent (STT/TTS/VAD)
                              │
                              │ ACP (stdio or WebSocket)
                              ▼
                         OpenClaw (ACP agent)
```

Both paths connect to OpenClaw as ACP clients. Both use the same `session_key` (via `_meta` in `session/new`) so OpenClaw maintains one conversation thread regardless of which mode produced each message.

**Key insight:** The relay and voice agent are both disposable ACP clients. All conversation state lives in OpenClaw. If the relay disconnects, no state is lost. If the voice agent dies and LiveKit dispatches a new one, no state is lost. OpenClaw resumes the conversation based on session key.

### What the relay does

1. **Joins LiveKit rooms** as a non-agent participant (auto-joined via LiveKit webhook on `participant_joined`)
2. **Manages the ACP session** — `initialize` + `session/new` with routing metadata
3. **Transparent ACP forwarding** between data channel and OpenClaw:
   - Mobile sends `session/prompt` → relay adds `sessionId`, forwards to OpenClaw
   - OpenClaw sends `session/update` → relay forwards to mobile as-is (no parsing of `update` content)
   - Mobile sends `session/cancel` → relay forwards to OpenClaw
4. **Idle management** — disconnects from room after configurable timeout (default 5 min, `RELAY_IDLE_TIMEOUT_MS`)
5. **Health endpoints** — HTTP `/health`, `/rooms` for monitoring

### What the relay does NOT do

- Parse or translate SSE streams (ACP handles streaming natively)
- Maintain conversation history (OpenClaw holds it)
- Define its own protocol (uses ACP)
- Route voice traffic (voice agent has its own ACP connection)

## Protocol: ACP over LiveKit Data Channel

The data channel carries **ACP JSON-RPC 2.0 messages** on the `"relay"` topic. See `data-channel-protocol.md` for the exact message formats and `acp-transport.md` for the full ACP spec.

The relay handles ACP lifecycle internally:
- `initialize` — relay sends on connect to OpenClaw
- `session/new` — relay sends with `_meta.session_key` for routing

The mobile sends/receives the subset it needs:
- `session/prompt` — send user message (relay adds `sessionId`)
- `session/cancel` — cancel in-flight request
- `session/update` — receive streaming content chunks (forwarded from OpenClaw)

## Relay Lifecycle

The relay does not maintain a permanent LiveKit room connection. It connects on demand and disconnects when idle.

```
1. Participant joins LiveKit room
        │
        │  LiveKit fires participant_joined webhook → relay receives it
        ▼
2. Relay auto-joins the room as a non-agent participant
        │
        │  Relay connects to OpenClaw via ACP (initialize + session/new)
        ▼
3. Session active — ACP messages forwarded over data channel
        │
        │  No messages for ~5 minutes
        ▼
4. Relay disconnects from room + ACP session
        │
        │  User rejoins room → webhook triggers relay rejoin
        ▼
5. Repeat (fresh ACP session, same session_key → same conversation)
```

**Trigger mechanism:** The relay is self-driving via LiveKit webhooks. LiveKit sends a `participant_joined` event to `POST /webhooks/livekit` whenever a participant connects. The relay filters out its own joins (`relay-*` identity) and agent participants, then calls `addRoom()` for standard participants. No token server signaling needed.

**Startup recovery:** On startup, the relay queries LiveKit's `RoomServiceClient` to discover rooms with active human participants but no relay. It auto-joins any orphaned rooms, recovering from restarts without requiring users to leave and rejoin. This runs as fire-and-forget after the HTTP server starts — the server is immediately ready for webhooks while discovery runs async. LiveKit is the source of truth; no persistence files needed.

**Manual override:** `POST /relay/join` still exists for debugging and testing — it calls the same `addRoom()` path.

**Idle disconnect:** The relay tracks last-message time per room. After a configurable idle timeout (~5 minutes), it disconnects from the room. The next participant join webhook restarts the cycle.

**Cost implication:** Relay participant minutes only tick during active sessions. Zero relay cost between sessions.

### Cloud Deployment (future — only needed for hosted version)

The current webhook approach assumes a single relay instance receiving all events from a local LiveKit server. This works for the local-first setup but does not scale to LiveKit Cloud with multiple relays.

**Problem:** LiveKit webhook config is server-wide — every URL in the list receives every room event. With N relays, all N would try to join the same room. LiveKit Cloud provides a project (shared server pool), not individual server instances you can pair 1:1 with relays.

**Solution: Webhook dispatcher pattern**

```
LiveKit Cloud
    │
    │  participant_joined webhook (all room events)
    ▼
Dispatcher Service (stateless router)
    │
    │  Selects correct relay (round-robin, region, load)
    │  POST /relay/join { roomName }
    ▼
Relay Instance N
```

The dispatcher is a thin stateless service that receives all LiveKit webhooks, selects the appropriate relay for each room, and signals it via `POST /relay/join` — the same endpoint used today for manual/debug joins. Individual relays would not run their own webhook handlers in this setup.

**Not needed now.** Fletcher is local-first — single LiveKit server, single relay, direct webhook. The dispatcher only becomes necessary if/when we deploy a hosted multi-tenant version on LiveKit Cloud.

## Session Routing

Both the relay and voice agent route to the same OpenClaw conversation via `_meta.session_key` in `session/new`:

```jsonc
// Relay → OpenClaw
{
  "method": "session/new",
  "params": {
    "cwd": "/",
    "mcpServers": [],
    "_meta": {
      "session_key": { "type": "owner", "key": "alice" },
      "room_name": "room_abc",
      "participant_identity": "alice"
    }
  }
}
```

Each relay lifecycle gets a fresh ACP session ID, but OpenClaw maps it to the same conversation based on `_meta.session_key`. This mirrors how the voice agent works — disposable ACP sessions, persistent conversations.

## Mode Coordination

The relay and voice agent share LiveKit rooms but never both handle LLM requests simultaneously. Room metadata (`mode: "voice" | "chat" | "idle"`) coordinates handoffs. See `room-metadata-schema.md` for the full state machine and handoff protocols.

## ACP Transport Options

The relay can connect to OpenClaw via two ACP transports:

| Transport | Config | Use case |
|---|---|---|
| **stdio** | `ACP_TRANSPORT=stdio ACP_COMMAND=openclaw` | Local: relay spawns OpenClaw as subprocess |
| **WebSocket** | `ACP_TRANSPORT=websocket ACP_URL=wss://...` | Remote: relay connects to hosted OpenClaw |

For the Fletcher product (local-first), stdio is the default — the relay spawns OpenClaw directly. WebSocket enables future cloud deployment without changing the relay.

## Known Gaps (Session Resilience)

Session resilience gaps identified during field testing (March 2026). lazy-acp-reinit/participant-left-webhook/touch-on-incoming are resolved. rejoin-rooms-on-restart (room discovery) is implemented.

### 1. No ACP recovery on subprocess death (lazy-acp-reinit)

If the ACP subprocess dies mid-session (crash, OOM, broken pipe), the bridge enters a zombie state: the LiveKit room stays connected, mobile messages arrive, but `acpClient.sessionPrompt()` throws. No recovery path exists — the room stays zombie until the idle timer fires.

**Planned fix:** Detect subprocess exit, set a `needsReinit` flag, lazily re-initialize ACP on the next incoming mobile message. Also increase the default idle timeout from 5 minutes to 30 minutes.

### 2. No cleanup on participant disconnect (participant-left-webhook)

The `participant_left` webhook event is not handled (`src/http/webhook.ts` only handles `participant_joined`). When the last human participant leaves, the ACP subprocess and LiveKit room connection stay alive until the idle timer fires — wasting resources for up to 5 minutes (or 30 minutes after lazy-acp-reinit).

**Planned fix:** Handle `participant_left` webhook, tear down the bridge when the last human participant leaves.

### 3. Incoming messages don't reset idle timer (touch-on-incoming)

The idle timer only resets on **outbound** data (`sendToRoom()` sets `conn.lastActivity`). Incoming mobile messages (`session/prompt`, `session/cancel`) do not reset it. `RoomManager.touchRoom()` exists but is never called.

**Planned fix:** Call `touchRoom()` at the top of `handleMobileMessage()` in `RelayBridge`.

## Relation to Voice Path

```
Before (HTTP/SSE):
  Voice:  Mobile → LiveKit → livekit-agent → Ganglia → HTTP/SSE → OpenClaw
  Text:   (not supported)

After (ACP):
  Voice:  Mobile → LiveKit → livekit-agent → ACP → OpenClaw
  Text:   Mobile → LiveKit → Relay (participant) → ACP → OpenClaw
```

Both paths use ACP. Both share session context via session key. The relay doesn't proxy voice — the voice agent has its own ACP connection. This eliminates the coupling between text and voice paths that caused the sleep/wake bugs documented in the March 9-10 field tests.

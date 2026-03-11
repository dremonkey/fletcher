# Claude Relay — Architecture

## Problem

Fletcher uses `livekit-agent` for voice. It works well for voice but the billing model makes text-only interactions uneconomical:

- Agent session minutes: **$0.01/min**
- Minimum billing unit: **1 minute per session**
- A 10-second text interaction costs the same as a 60-second voice session

The goal is a text (and eventually richer) interaction path that bypasses the agent framework entirely.

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

The relay is the **single gateway** to all AI backends. Both the voice and text paths route through it:

```
                    ┌─────────────────────────────────────────┐
                    │             Claude Relay (Bun)           │
                    │                                          │
Mobile ──WebRTC──▶  │  LiveKit participant  ←─ text sessions  │
(data channel)      │                                          │  ──▶ OpenClaw
                    │  HTTP (completions)   ←─ voice sessions  │  ──▶ Claude Agent SDK
livekit-agent ────▶ │  (Ganglia calls here)                   │
                    │                                          │
                    └─────────────────────────────────────────┘
```

**Text path:** Mobile connects to a LiveKit room. The relay joins the same room as a non-agent participant. JSON-RPC 2.0 flows over the data channel.

**Voice path:** `livekit-agent` continues to run (handling STT/TTS/VAD). Ganglia, currently pointing at OpenClaw directly, is redirected to call the relay's HTTP endpoint instead. The relay forwards to the configured backend. Ganglia requires no protocol change — the relay exposes the same OpenAI-compatible completions interface OpenClaw does.

The relay is a Bun process running on the same host as the AI backend. It is not deployed on LiveKit Cloud infrastructure — it is a self-hosted process that connects to LiveKit as a client.

**Why route voice through the relay too:**
- Single place to manage backend switching (`RELAY_BACKEND`)
- Single place for session management and routing logic
- The richer stream protocol (background task push, richer events) becomes available to voice sessions too, not just text
- Ganglia can eventually be updated to use the richer protocol instead of bare completions

## Relay Lifecycle

The relay does not maintain a permanent LiveKit room connection. It connects on demand and disconnects when idle — the same pattern as livekit-agent dispatch, without using the agent framework.

```
1. Mobile requests token from token server
        │
        │  Token server signals relay: "join room X"
        ▼
2. Relay joins LiveKit room as participant
        │
        │  Data channel established
        ▼
3. Session active — JSON-RPC messages over data channel
        │
        │  No messages for ~5 minutes
        ▼
4. Relay disconnects, room closes
        │
        │  Mobile reconnects → token request → relay rejoins
        ▼
5. Repeat
```

**Trigger mechanism:** The token request is the natural trigger. The token server (already an HTTP service on the same host) signals the relay to join the target room as a side effect of issuing the token. This requires no new infrastructure — the relay exposes a local HTTP endpoint that the token server calls.

**Idle disconnect:** The relay tracks last-message time per room. After a configurable idle timeout (~5 minutes), it disconnects from the room. The next token request restarts the cycle.

**Cost implication:** Relay participant minutes only tick during active sessions. Zero relay cost between sessions.

## Protocol

JSON-RPC 2.0 messages sent over the LiveKit data channel (same protocol designed for the WebSocket approach — transport-agnostic).

### Client → Relay

| Method | Params | Description |
|---|---|---|
| `session/new` | `{ prompt }` | Start a new conversation |
| `session/message` | `{ sessionId, content }` | Send message to running session |
| `session/resume` | `{ sessionId, prompt }` | Resume after reconnect |
| `session/cancel` | `{ sessionId }` | Cancel running task |
| `session/list` | — | List active sessions |

### Relay → Client

| Method | Params | Description |
|---|---|---|
| `session/update` | `{ sessionId, type, content }` | Streaming text delta |
| `session/complete` | `{ sessionId, result }` | Task completed |
| `session/error` | `{ sessionId, error }` | Error |
| `session/push` | `{ sessionId, type, payload }` | Background task completion pushed to client |

The `session/push` notification is the key addition over the completions API — it allows the relay to push results from long-running background tasks when they complete, without the client having to poll.

## Background Task Delivery

When the mobile app is backgrounded:

- **Android:** The foreground service already running for voice keeps the LiveKit connection alive. The data channel stays open. `session/push` is delivered normally.
- **iOS:** iOS suspends the app. The LiveKit connection dies. Push notifications (FCM/APNs) are required to wake the app; on resume it reconnects and the relay delivers buffered events.

The relay buffers completed task events for reconnecting clients for a configurable window (default: 30 minutes).

## Backend Abstraction

The relay is transport, not backend. It bridges the LiveKit data channel to whichever AI backend is configured via `RELAY_BACKEND`:

| Value | Backend | Use case |
|---|---|---|
| `openclaw` | OpenClaw Gateway (HTTP) | Self-hosted, multi-user reasoning engine |
| `claude` | Claude Agent SDK | Direct Anthropic API, full agentic tool use |

Both backends expose the same interface to the relay's session manager — the JSON-RPC protocol is identical regardless of which backend is active. This mirrors the Ganglia pattern in the voice pipeline (`GANGLIA_TYPE=openclaw` vs `GANGLIA_TYPE=nanoclaw`).

Adding a new backend means implementing the backend interface; no changes to transport, session management, or protocol.

## Relation to Voice Path

```
Before:
  Voice:  Mobile → LiveKit → livekit-agent (Ganglia → OpenClaw directly)
  Text:   (not supported)

After:
  Voice:  Mobile → LiveKit → livekit-agent (Ganglia → Relay → backend)
  Text:   Mobile → LiveKit → Relay (participant) → backend
```

`livekit-agent` continues to own STT, TTS, and VAD — the parts that justify its cost for voice. The relay takes over the LLM backend connection only. Ganglia is redirected from calling OpenClaw directly to calling the relay's completions-compatible HTTP endpoint. This is a one-line config change to `OPENCLAW_GATEWAY_URL` (or equivalent).

Both paths share the relay's session management and backend abstraction. A voice session and a text session for the same user map to the same session in the relay, preserving conversation context across modalities.

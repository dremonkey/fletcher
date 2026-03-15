# ACP-Based Full-Duplex Voice Agent Transport

**Status:** Active (chat mode live; voice ACP pending task 052)
**Updated:** 2026-03-12 (field test — confirmed OpenClaw wire format)
**Scope:** Voice agent ↔ LLM backend transport via Agent Client Protocol (ACP)
**Spec:** [agentclientprotocol.com](https://agentclientprotocol.com/protocol/overview.md)

## Problem

The current ganglia transport is **half-duplex HTTP/SSE**: the voice agent sends an HTTP POST to OpenClaw's `/v1/chat/completions`, the backend streams tokens back via SSE, then the connection closes. Each turn is a discrete request-response cycle.

This model breaks down when an external controller (e.g. Claude Code) needs to:

1. **Push instructions mid-turn** — inject context, cancel a response, or redirect the conversation while the agent is already speaking.
2. **Receive real-time events** — observe pipeline state (STT interim transcripts, EOU detection, TTS status, tool calls) without polling.
3. **Coordinate multi-modal flows** — e.g. Claude Code triggers a tool call result that the voice agent should incorporate *immediately*, not on the next turn boundary.

HTTP/SSE cannot do this. The server cannot push unsolicited messages to the client, and the client cannot send data on an active SSE stream.

## Prior Art: ACPX

OpenClaw already uses [ACPX](https://github.com/openclaw/acpx) — a headless ACP client — to call out to coding agents (Claude Code, Codex, etc.). ACPX proves the pattern:

- ACP sessions over stdio with persistent multi-turn state
- Prompt queueing and cooperative cancellation (`session/cancel`)
- Structured output collection from agent responses
- Lifecycle management (idle TTL, reconnect, graceful shutdown)

This spec applies the same pattern in the opposite direction: the **voice agent acts as an ACP client**, connecting to OpenClaw or Claude Code as the ACP agent.

## Proposed Solution

Add an **ACP-based** ganglia backend (`GANGLIA_TYPE=acp`) where the voice agent is a headless ACP client — analogous to ACPX but optimized for real-time voice.

### Architecture Options

```
Option A: voice-agent <──ACP──> OpenClaw (as ACP agent)

┌──────────────┐                    ┌──────────────┐          ┌─────────┐
│  Voice Agent │──ACP (stdio/ws)───►│   OpenClaw   │─────────►│   LLM   │
│  (ACP client)│◄───────────────────│  (ACP agent) │          │         │
└──────────────┘                    └──────────────┘          └─────────┘
  replaces HTTP/SSE completions      already has ACP adapter


Option B: voice-agent <──ACP──> Claude Code (as ACP agent)

┌──────────────┐                    ┌──────────────┐
│  Voice Agent │──ACP (stdio/ws)───►│  Claude Code │
│  (ACP client)│◄───────────────────│  (ACP agent) │
└──────────────┘                    └──────────────┘
  Claude Code IS the brain           already an ACP agent


Option C: voice-agent <──ACP──> OpenClaw <──ACPX──> Claude Code

┌──────────────┐       ┌──────────┐       ┌──────────────┐
│  Voice Agent │──ACP─►│ OpenClaw │──ACPX►│  Claude Code │
│  (ACP client)│◄──────│(ACP agent│◄──────│  (ACP agent) │
└──────────────┘       │ + client)│       └──────────────┘
                       └──────────┘
  OpenClaw orchestrates, delegates coding tasks to Claude Code
```

All three options use the same voice-agent ACP client implementation. The backend is swappable.

## Design Principle: Stateless Voice Tunnel

The voice agent is **stateless** — a disposable tunnel between the user's microphone/speaker and the ACP agent. It holds no conversation history, no session state, no persistent context.

**Lifecycle:**
1. User becomes active → LiveKit dispatches a voice agent
2. Voice agent spins up → `initialize` → `session/new` → starts prompting
3. User goes silent → idle timeout fires → voice agent disconnects and dies
4. User comes back → LiveKit dispatches a *new* voice agent → repeat from step 2

**All state lives in the ACP agent** (OpenClaw or Claude Code). The ACP agent correlates sessions by the session key (participant identity / room) passed in `session/new` metadata — not by ACP session ID. Each voice agent lifecycle gets a fresh ACP session ID, but the backend maps it to the same underlying conversation.

**Implications:**
- **No `session/load` for voice agents** — every voice agent lifecycle starts with `session/new`. The ACP agent doesn't need to advertise `loadSession` capability for voice. (NOTE: `session/load` will be used for session resumption via mobile-initiated history load — see EPIC-25.)
- **No reconnection logic** — if the connection drops, the voice agent is already dying (idle timeout, network failure, process crash). LiveKit dispatches a fresh agent when the user returns.
- **No in-flight recovery** — if a `session/prompt` is pending when the connection dies, that turn is lost. The user speaks again and triggers a new turn on the new agent.
- **No heartbeat required** — the voice agent has its own idle timeout (default 5 min). LiveKit's `departure_timeout` (120s) covers the gap between agent death and user return.
- **Lost injects are acceptable** — if the ACP agent sends `x/voice/inject` during downtime, it's gone. These are ephemeral push commands, not durable state.

This mirrors how Fletcher works today with HTTP/SSE — each HTTP request is stateless, the voice agent is ephemeral, and OpenClaw holds conversation state keyed by session routing headers.

## ACP Protocol Mapping

The voice agent uses standard ACP methods where they fit, and ACP extensions (`ExtRequest` / `ExtNotification`) for voice-specific capabilities.

### Standard ACP Flow

#### 1. Initialize

Voice agent spawns or connects to the ACP agent, negotiates capabilities.

```jsonc
// Voice Agent → ACP Agent
{
  "jsonrpc": "2.0",
  "id": 0,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientInfo": {
      "name": "fletcher-voice-agent",
      "title": "Fletcher Voice Agent",
      "version": "1.0.0"
    },
    "clientCapabilities": {
      "fs": { "readTextFile": false, "writeTextFile": false },
      "terminal": false
    }
  }
}
```

The voice agent advertises **no filesystem or terminal access** — it's a headless voice client, not an editor. This tells the ACP agent not to request file reads/writes or terminal commands.

```jsonc
// ACP Agent → Voice Agent
// (OpenClaw actual response, verified 2026-03-12)
{
  "jsonrpc": "2.0",
  "id": 0,
  "result": {
    "protocolVersion": 1,
    "agentCapabilities": {
      "loadSession": true,
      "promptCapabilities": { "image": true, "audio": false, "embeddedContext": true },
      "mcpCapabilities": { "http": false, "sse": false },
      "sessionCapabilities": { "list": {} }
    },
    "agentInfo": {
      "name": "openclaw-acp",
      "title": "OpenClaw ACP Gateway",
      "version": "2026.3.1"
    },
    "authMethods": []
  }
}
```

After receiving the `initialize` response, the client **MUST** send an `initialized` notification (no `id`):

```jsonc
{ "jsonrpc": "2.0", "method": "initialized" }
```

#### 2. Create Session

Each voice agent lifecycle creates a fresh ACP session. Session routing metadata travels in `_meta` so the ACP agent can map this disposable ACP session to the correct persistent conversation on its side.

```jsonc
// Voice Agent → ACP Agent
// Standard ACP fields: cwd, mcpServers
// _meta is an ACP extension field — used here to pass routing metadata to OpenClaw
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "session/new",
  "params": {
    "cwd": "/",
    "mcpServers": [],
    "_meta": {
      "voice": true,
      "session_key": { "type": "owner", "key": "alice" },
      "room_name": "room_abc",
      "room_sid": "RM_xyz",
      "participant_identity": "alice"
    }
  }
}
```

The `_meta` field is the ACP-standard extension point for arbitrary metadata (all protocol types support `_meta`). OpenClaw uses `_meta.session_key` to resume the correct persistent conversation even though the ACP session itself is brand new.

```jsonc
// ACP Agent → Voice Agent
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "sessionId": "sess_abc123"
  }
}
```

#### 3. Send Prompt (User Speaks)

Each voice turn maps to `session/prompt`. The user's STT transcript becomes the prompt content.

```jsonc
// Voice Agent → ACP Agent
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "session/prompt",
  "params": {
    "sessionId": "sess_abc123",
    "prompt": [
      { "type": "text", "text": "What's the weather like?" }
    ]
  }
}
```

#### 4. Streaming Response

The ACP agent streams `session/update` notifications as the response is generated. Each notification carries a **single `update` object** (not an array) with a `sessionUpdate` discriminator field.

> **Important:** The params shape is `{ sessionId, update: {} }` — singular `update`, not `updates[]`.
> This was confirmed against the [official ACP spec](https://agentclientprotocol.com/protocol/prompt-turn.md)
> and verified against OpenClaw in the 2026-03-12 Fletcher field test (BUG-001).

```jsonc
// ACP Agent → Voice Agent (notification, one per chunk)
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123",
    "update": {
      "sessionUpdate": "agent_message_chunk",
      "content": { "type": "text", "text": "The weather is" }
    }
  }
}
```

```jsonc
// ACP Agent → Voice Agent (more chunks...)
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123",
    "update": {
      "sessionUpdate": "agent_message_chunk",
      "content": { "type": "text", "text": " sunny and 72°F." }
    }
  }
}
```

#### Known `sessionUpdate` kinds

| `sessionUpdate` | When emitted | Key fields |
|-----------------|--------------|------------|
| `agent_message_chunk` | During response streaming | `content: ContentBlock` (usually `{ type: "text", text }`) |
| `available_commands_update` | On `session/new` and when slash commands change | `availableCommands: { name, description, input? }[]` |
| `plan` | When agent creates/updates a task plan | `plan: { tasks: { id, title, status }[] }` |
| `tool_call` | When agent invokes a tool | `id, title, input` |
| `tool_call_update` | As tool execution progresses | `id, status: "in_progress" \| "completed", content?` |

Only `agent_message_chunk` carries response text for the user. The relay filters and only forwards this kind to mobile; all others are dropped.

#### 5. Turn Complete

The `session/prompt` request resolves with a `PromptResponse` containing the stop reason.

```jsonc
// ACP Agent → Voice Agent (response to id: 3)
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "stopReason": "completed"
  }
}
```

#### 6. Cancellation (Barge-In)

When the user interrupts, the voice agent sends `session/cancel`:

```jsonc
// Voice Agent → ACP Agent (notification)
{
  "jsonrpc": "2.0",
  "method": "session/cancel",
  "params": {}
}
```

The agent finishes in-flight work and responds to the pending `session/prompt` with `stopReason: "cancelled"`.

### Voice-Specific ACP Extensions

The ACP spec reserves method names with a leading `_` for custom extensions (e.g. `_namespace/method`). We use the `_fletcher` namespace for voice-specific methods:

> **Note on naming:** The ACP spec uses `_` prefix for extensions (see
> [extensibility spec](https://agentclientprotocol.com/protocol/extensibility.md)).
> These methods were originally prototyped as `x/voice/*` — rename to `_fletcher/voice/*`
> before shipping task 052.

#### `_fletcher/voice/inject` (ACP Agent → Voice Agent, request)

The key duplex capability. The ACP agent (OpenClaw or Claude Code) pushes an instruction to the voice agent at any time — not in response to a prompt.

```jsonc
{
  "jsonrpc": "2.0",
  "id": "inject_1",
  "method": "_fletcher/voice/inject",
  "params": {
    "action": "say",
    "text": "By the way, your package has been delivered.",
    "priority": "normal"
  }
}
```

| Action | Behavior |
|--------|----------|
| `say` | Queue text for TTS. Bypasses LLM. |
| `interrupt` | Stop current speech, optionally replace with new text. |
| `context` | Inject a system message for the next LLM turn (no speech). |
| `config` | Change runtime config (TTS on/off, voice, VAD sensitivity). |

Voice agent responds with success/failure:

```jsonc
{
  "jsonrpc": "2.0",
  "id": "inject_1",
  "result": { "accepted": true }
}
```

#### `_fletcher/voice/event` (Voice Agent → ACP Agent, notification)

Voice agent pushes real-time pipeline events. These have no equivalent in standard ACP.

```jsonc
{
  "jsonrpc": "2.0",
  "method": "_fletcher/voice/event",
  "params": {
    "type": "user_transcript",
    "data": {
      "segment_id": "user_seg_3",
      "text": "What's the weath—",
      "final": false
    }
  }
}
```

Event types:

| Type | Payload | Description |
|------|---------|-------------|
| `user_transcript` | `{ segment_id, text, final }` | STT interim/final results |
| `agent_transcript` | `{ segment_id, text, final }` | LLM output chunks (for display) |
| `agent_state` | `{ state }` | `listening` / `thinking` / `speaking` |
| `pipeline_error` | `{ source, message, recoverable }` | TTS/STT/LLM failures |
| `metrics` | `{ eou_ms, ttft_ms, tts_ttfb_ms }` | Per-turn latency |

## Transport

ACP supports two transports. Both work for this use case:

### stdio (local, like ACPX)

Voice agent spawns the ACP agent as a subprocess. JSON-RPC flows over stdin/stdout. This is how ACPX works today.

```
voice-agent process
  └─ spawns: openclaw acp --mode voice
     └─ stdin/stdout: JSON-RPC messages
```

**Pros:** Simple, no network setup, works locally. Process lifecycle is tied to the voice agent — when the voice agent dies, the subprocess dies too. No orphan cleanup needed.
**Cons:** Agent must run on the same machine. No remote/cloud deployment.

### WebSocket (remote)

Voice agent connects to a WebSocket endpoint. JSON-RPC flows as text frames.

```
voice-agent ──wss://gateway.example.com/v1/acp──► openclaw
```

**Pros:** Works across networks, cloud-native.
**Cons:** Requires WebSocket server on the ACP agent side.

The ganglia backend should support both transports, selectable via config.

### Connection Drop Behavior

Because the voice agent is stateless, connection drops are handled simply:

| Scenario | What Happens |
|----------|-------------|
| **stdio: subprocess crashes** | Voice agent detects EOF on stdin. The LiveKit `AgentSession` emits a close event. LiveKit dispatches a new agent on next user activity. |
| **WebSocket: socket drops** | Voice agent detects close/error. Same outcome — session closes, LiveKit re-dispatches. |
| **Voice agent crashes** | LiveKit's `departure_timeout` (120s) expires. Next user activity triggers fresh agent dispatch. |
| **Network partition during prompt** | The pending `session/prompt` times out or errors. The voice agent's pipeline emits an error event. User speaks again → new turn attempt (or if the agent is dead, LiveKit re-dispatches). |
| **User returns after idle disconnect** | LiveKit dispatches a brand new voice agent. Fresh `initialize` → `session/new` with the same `session_key`. ACP agent resumes the conversation from its side. |

No reconnection logic, no session reload, no retry loops. The voice agent is disposable. The ACP agent is durable.

## Ganglia Integration

### New Files

```
packages/livekit-agent-ganglia/src/
├── acp-client.ts            # ACP client (stdio + WebSocket transport)
├── acp-llm.ts               # AcpLLM extends llm.LLM, implements GangliaLLM
├── acp-stream.ts            # AcpChatStream extends llm.LLMStream
└── types/acp.ts             # ACP type definitions (reuse @anthropic/acp-sdk types if available)
```

### `AcpLLM` (extends `llm.LLM`, implements `GangliaLLM`)

```typescript
class AcpLLM extends LLMBase implements GangliaLLM {
  private acp: AcpClient;          // manages transport + JSON-RPC
  private sessionId?: string;       // ACP session ID (ephemeral, per voice-agent lifecycle)
  private _onInject?: (params: VoiceInjectParams) => void;

  constructor(config: AcpConfig) {
    super();

    // Initialize ACP client with chosen transport
    this.acp = config.transport === 'stdio'
      ? AcpClient.stdio(config.command, config.args)
      : AcpClient.websocket(config.url, { authToken: config.apiKey });

    // Handle voice-specific extension requests from the agent
    this.acp.onRequest('x/voice/inject', async (params) => {
      this._onInject?.(params);
      return { accepted: true };
    });
  }

  /**
   * ACP handshake + session creation.
   * Called once per voice-agent lifecycle, during agent entry.
   * Session routing metadata is passed so the ACP agent can map this
   * ephemeral ACP session to the correct persistent conversation.
   */
  async initialize(sessionMeta: {
    sessionKey: SessionKey;
    roomName: string;
    roomSid?: string;
    participantIdentity: string;
  }): Promise<void> {
    // ACP handshake
    await this.acp.request('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'fletcher-voice-agent', version: '1.0.0' },
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
    });

    // Create session with routing metadata
    const { sessionId } = await this.acp.request('session/new', {
      cwd: '/',
      mcpServers: [],
      _meta: {
        voice: true,
        session_key: sessionMeta.sessionKey,
        room_name: sessionMeta.roomName,
        room_sid: sessionMeta.roomSid,
        participant_identity: sessionMeta.participantIdentity,
      },
    });
    this.sessionId = sessionId;
  }

  chat({ chatCtx, toolCtx, connOptions }): AcpChatStream {
    return new AcpChatStream(this, this.acp, {
      chatCtx,
      toolCtx,
      sessionId: this.sessionId!,
    });
  }

  gangliaType(): string { return 'acp'; }
  label(): string { return 'acp'; }
}
```

### `AcpChatStream` (extends `llm.LLMStream`)

```typescript
class AcpChatStream extends LLMStream {
  private acp: AcpClient;
  private sessionId: string;

  async run(): Promise<void> {
    const userText = this.extractLatestUserMessage();

    // Listen for streaming content chunks via session/update notifications.
    // params shape: { sessionId, update: { sessionUpdate: string, ... } }
    // — singular `update` object per the ACP spec and confirmed against OpenClaw.
    const unsubscribe = this.acp.onNotification('session/update', (params) => {
      const { update } = params;
      if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
        this.queue.put({
          id: this.sessionId,
          delta: {
            role: 'assistant',
            content: update.content.text,
          },
        });
      }
      // Other kinds: available_commands_update, plan, tool_call, tool_call_update — not yet handled
    });

    try {
      // session/prompt blocks until the agent finishes (or is cancelled)
      const response = await this.acp.request('session/prompt', {
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text: userText }],
      });

      // stopReason: "completed" | "cancelled"
      if (response.stopReason === 'cancelled') {
        dbg.acpStream('prompt cancelled (barge-in)');
      }
    } finally {
      unsubscribe();
    }
  }

  close(): void {
    // Barge-in: send session/cancel, then close the stream
    this.acp.notify('session/cancel', {});
    super.close();
  }
}
```

### Factory Registration

```typescript
// In acp-llm.ts
registerGanglia('acp', async () => AcpLLM);
```

### Config

```typescript
interface AcpConfig {
  transport: 'stdio' | 'websocket';

  // stdio transport
  command?: string;       // e.g. "openclaw" or "claude"
  args?: string[];        // e.g. ["acp", "--mode", "voice"]

  // websocket transport
  url?: string;           // wss://gateway.example.com/v1/acp
  apiKey?: string;        // Bearer token

  // shared
  logger?: Logger;
}
```

Env vars:
```bash
GANGLIA_TYPE=acp

# stdio transport (spawn agent as subprocess)
ACP_TRANSPORT=stdio
ACP_COMMAND="openclaw"
ACP_ARGS="acp --mode voice"

# OR websocket transport (connect to remote agent)
ACP_TRANSPORT=websocket
ACP_URL=wss://gateway.example.com/v1/acp
OPENCLAW_API_KEY=sk-...
```

## Connection Lifecycle

```
Voice Agent                                ACP Agent (OpenClaw / Claude Code)
    │                                              │
    │         ┌─ STARTUP ─┐                        │
    ├──── initialize {...} ───────────────────────►│
    │◄─── result {protocolVersion, caps} ──────────┤
    │                                              │
    ├──── session/new {_meta: {session_key}} ─────►│  (routing metadata)
    │◄─── result {sessionId} ──────────────────────┤
    │         └───────────┘                        │
    │                                              │
    │         ┌─ ACTIVE (minutes) ─┐               │
    │                                              │
    ├──── session/prompt {text} ──────────────────►│  (user speaks)
    │◄─── session/update {content_chunk} ──────────┤  (LLM tokens, streamed)
    │◄─── session/update {content_chunk} ──────────┤
    │◄─── result {stopReason: completed} ──────────┤  (turn done)
    │                                              │
    │◄─── x/voice/inject {say: "..."} ────────────┤  (push from Claude Code)
    ├──── result {accepted: true} ────────────────►│
    │                                              │
    ├──── x/voice/event {user_transcript} ────────►│  (real-time events)
    │                                              │
    ├──── session/prompt {text} ──────────────────►│  (next turn)
    │◄─── ...                                      │
    │                                              │
    ├──── session/cancel ─────────────────────────►│  (barge-in)
    │◄─── result {stopReason: cancelled} ──────────┤
    │         └────────────────────┘                │
    │                                              │
    │         ┌─ SHUTDOWN ─┐                       │
    │    (idle timeout / disconnect)               │
    │    voice agent process exits                 │
    │    ACP connection closes                     │
    │         └────────────┘                       │
    │                                              │
    │    ═══ time passes (seconds to hours) ═══    │
    │                                              │
    │         ┌─ NEW AGENT ─┐                      │
    ├──── initialize {...} ───────────────────────►│  (fresh process)
    ├──── session/new {_meta: {session_key}} ─────►│  (same session_key!)
    │◄─── result {sessionId: "sess_NEW"} ──────────┤  (new ACP session,
    │         └─────────────┘                      │   same conversation)
    │                                              │
```

## Key Design Decisions

### 1. Stateless voice tunnel

The voice agent holds zero conversation state. It is a disposable bridge between the user's microphone/speaker and the ACP agent. All conversation history, session context, and persona live in the ACP agent (OpenClaw/Claude Code). This matches Fletcher's existing HTTP/SSE model and enables:
- **Instant spin-up** — no state to restore, no session to reload
- **Clean failure** — if the voice agent crashes, nothing is lost
- **Elastic scaling** — LiveKit can dispatch any available agent; they're interchangeable

### 2. Session routing via `_meta`

The ACP `session/new` `_meta` field carries the session key (participant identity, room). The ACP agent uses this to map the ephemeral ACP session to its internal persistent conversation. This replaces the HTTP headers (`x-openclaw-session-key`) used in the current completions transport.

### 3. ACP over custom protocol

Using ACP instead of a bespoke WebSocket+JSON-RPC protocol because:
- OpenClaw already has an ACP adapter (used by ACPX)
- Claude Code is already an ACP agent
- Sessions, streaming, cancellation, and capability negotiation are built in
- Extension mechanism (`x/voice/*`) handles voice-specific needs cleanly
- Existing SDKs for TypeScript, Python, Rust, Kotlin

### 4. Voice agent as ACP client (not agent)

The voice agent is the *client* in ACP terms — it sends prompts, receives responses. This maps naturally: the voice pipeline is a consumer of LLM output, just like an editor. The ACP agent (OpenClaw/Claude Code) does the thinking.

### 5. No filesystem or terminal capabilities

The voice agent advertises `fs: false, terminal: false` during initialization. If the ACP agent requests `fs/read_text_file` or `terminal/create`, the voice agent returns a JSON-RPC error. The voice agent is a mouth and ears, not an editor.

### 6. `x/voice/*` extension namespace

Voice-specific methods use the `x/voice/` prefix to stay within ACP's extension mechanism without conflicting with future ACP spec additions. Two extensions:
- `x/voice/inject` — agent pushes speech/interruption/config to the voice client
- `x/voice/event` — voice client pushes real-time pipeline telemetry to the agent

### 7. Backward compatibility

`GANGLIA_TYPE=acp` is opt-in. Existing `openclaw` (HTTP/SSE) and `nanoclaw` backends are untouched. The `GangliaLLM` interface and `llm.LLM` contract are unchanged — only the transport differs.

### 8. Dual transport support

The ACP client supports both stdio (spawn subprocess) and WebSocket (connect to remote). This mirrors ACPX's model and allows:
- **Local dev:** `ACP_TRANSPORT=stdio ACP_COMMAND=openclaw` — voice agent spawns OpenClaw directly
- **Production:** `ACP_TRANSPORT=websocket ACP_URL=wss://...` — voice agent connects to hosted gateway

## Comparison: ACP vs. HTTP/SSE Completions

| Aspect | HTTP/SSE (current) | ACP (proposed) |
|--------|-------------------|----------------|
| Direction | Half-duplex (request → stream) | Full-duplex (both push) |
| Voice agent state | Stateless | Stateless |
| Session routing | HTTP headers (`x-openclaw-session-key`) | `session/new` `_meta.session_key` |
| Conversation state | Held by OpenClaw | Held by ACP agent |
| Cancellation | Abort HTTP request | `session/cancel` notification |
| Push from backend | Not possible | `x/voice/inject` |
| Event streaming | Separate LiveKit data channel | `x/voice/event` over same connection |
| Tool calls | In SSE stream | `session/update` with tool_call updates |
| Transport | HTTP only | stdio or WebSocket |
| Capability negotiation | None | `initialize` handshake |
| Connection drop | HTTP request fails, next turn retries | Voice agent dies, LiveKit re-dispatches |

## What This Spec Does NOT Cover

- **OpenClaw ACP agent implementation** — OpenClaw must expose an ACP agent interface (may already exist via ACPX's adapter). The details of that adapter are OpenClaw's concern.
- **Claude Code ACP agent specifics** — Claude Code is already an ACP agent. How it handles voice-extension methods (`x/voice/*`) is TBD — it may ignore them or implement voice-aware behavior.
- **Audio streaming** — Audio stays on LiveKit media tracks. ACP carries text only (prompts, transcripts, content chunks). No binary frames.
- **Flutter client changes** — The LiveKit data channel continues to serve the mobile app. ACP is a parallel control plane between voice-agent and its brain.
- **Migration from HTTP/SSE** — No deprecation planned. Both transports coexist indefinitely.

## Open Questions

1. **Tool calls via ACP** — ACP's `session/update` includes `ToolCallUpdate` for agent→client tool requests (file reads, terminal). OpenClaw's LLM-level tool calls (function calling) are different — they're part of the response content. Need to clarify how LLM function calls map to ACP updates.

2. **`x/voice/inject` interaction with in-flight prompts** — If a `session/prompt` is active (LLM streaming) and the agent sends `x/voice/inject { action: "say" }`, does the injected speech queue after the current response, or interrupt it? Need a clear priority model.

3. **ACP SDK reuse** — The `@anthropic/acp-sdk` TypeScript package (if it exists) could provide JSON-RPC framing, transport management, and type definitions. Worth evaluating vs. rolling our own minimal client.

4. **Bootstrap message** — Currently the voice agent sends a synthetic bootstrap message on connect (see `apps/voice-agent/src/bootstrap.ts`). With ACP, this would be the first `session/prompt` after `session/new`. The ACP agent could alternatively handle bootstrapping internally when it sees a new session with `_meta.voice: true`.

5. **History mode** — The current HTTP/SSE transport has `historyMode: 'latest' | 'full'` controlling how much context is sent per request. With ACP, the voice agent sends only the latest user utterance per `session/prompt` — the ACP agent manages history on its side. This is effectively `historyMode: 'latest'` by default, which is already the OpenClaw default.

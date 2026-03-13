# Task 064c: Ganglia RelayLLM Backend

**Epic:** 04 — Ganglia / Brain Plugin
**Status:** [x]
**Depends on:** none (can develop in parallel with 064a/064b)
**Blocks:** 064d

## Goal

Create the `RelayLLM` class and `RelayChatStream` with a pluggable transport abstraction for the Ganglia package. This is the voice-agent-side half of the relay-mediated LLM backend. When `GANGLIA_TYPE=relay`, the voice-agent routes LLM requests through the data channel to the relay instead of spawning its own ACP subprocess.

## Context

The existing `AcpLLM` + `AcpChatStream` pattern in `packages/livekit-agent-ganglia/src/` provides the template. The key differences:

| | AcpLLM / AcpChatStream | RelayLLM / RelayChatStream |
|---|---|---|
| **Send prompt** | `client.sessionPrompt()` over stdio | `publishData()` on `voice-acp` topic |
| **Receive chunks** | `client.onUpdate()` callback | `room.on(DataReceived)` listener |
| **Cancel** | `client.sessionCancel()` over stdio | Publish cancel on `voice-acp` |
| **Pondering, onContent, ChatChunk** | Same | Same |
| **Init** | Lazy subprocess spawn | Room reference via config |
| **Lifecycle** | Subprocess shutdown on `aclose()` | Unsubscribe data listener |

**Architecture decisions from review:**

1. **Pluggable transport abstraction** — `RelayChatStream` should cleanly separate orchestration (pondering, onContent, ChatChunk) from transport (data channel publish/subscribe). `AcpChatStream` is being retired once relay is validated — but the transport abstraction is good design regardless.
2. **Room in opts** — Room reference is passed via `createGangliaFromEnv({ room })`. Available at factory time (`ctx.room` exists before `waitForParticipant()`).
3. **Fail fast** — If no `relay-*` participant found in room, `chat()` throws immediately. No retry/fallback in this phase.

```
STREAM LIFECYCLE:
  RelayChatStream.run()
    1. Start pondering timer
    2. Publish JSON-RPC request on voice-acp topic
    3. Listen for voice-acp DataReceived events
       ├── session/update notification → extract chunk → ChatChunk → queue.put()
       │   ├── First content chunk → clear pondering, fire onContent
       │   └── Subsequent chunks → fire onContent, accumulate
       └── JSON-RPC result (id matches) → stream complete
    4. Timeout if no result within promptTimeoutMs
    5. Cleanup: unsubscribe, clear pondering timer

TRANSPORT ABSTRACTION:
  interface StreamTransport {
    sendRequest(request: JsonRpcRequest): void;
    onMessage(handler: (msg: JsonRpcMessage) => void): () => void;  // returns unsubscribe
    sendCancel(requestId: string): void;
  }

  DataChannelTransport implements StreamTransport {
    constructor(room: Room, topic: string)
    // Uses room.localParticipant.publishData() for send
    // Uses room.on(DataReceived) for receive
  }
```

## Implementation

### 1. Add relay config type (`packages/livekit-agent-ganglia/src/ganglia-types.ts`)

Add `RelayConfig` interface and extend the `GangliaConfig` discriminated union:

```typescript
export interface RelayConfig {
  /** LiveKit Room reference for data channel communication. */
  room: Room;
  /** Prompt timeout in ms (default: 120000). */
  promptTimeoutMs?: number;
  /** Optional logger. */
  logger?: Logger;
  /** Pondering callback. */
  onPondering?: (phrase: string | null, streamId: string) => void;
  /** Content callback. */
  onContent?: (delta: string, fullText: string, streamId: string) => void;
}

export type GangliaConfig =
  | { type: 'acp'; acp: AcpConfig; logger?: Logger }
  | { type: 'relay'; relay: RelayConfig; logger?: Logger }
  | { type: 'nanoclaw'; nanoclaw: NanoclawConfig; logger?: Logger };
```

### 2. Add debug namespaces (`packages/livekit-agent-ganglia/src/logger.ts`)

```typescript
export const dbg = {
  // ... existing namespaces ...
  relayStream: Debug('ganglia:relay:stream'),
  relayClient: Debug('ganglia:relay:client'),
};
```

### 3. Create transport abstraction (`packages/livekit-agent-ganglia/src/relay-transport.ts`)

Define the `StreamTransport` interface and `DataChannelTransport` implementation:

```typescript
/**
 * Abstract transport for relay LLM communication.
 *
 * Separates stream orchestration (pondering, ChatChunk, etc.) from the
 * underlying message delivery mechanism. Currently only DataChannelTransport
 * exists, but this abstraction allows swapping to WebSocket, HTTP, etc.
 */
export interface StreamTransport {
  /** Publish a JSON-RPC request. */
  sendRequest(request: object): void;
  /** Subscribe to incoming messages. Returns unsubscribe function. */
  onMessage(handler: (msg: unknown) => void): () => void;
  /** Publish a cancel notification. */
  sendCancel(requestId: string): void;
}
```

`DataChannelTransport`: uses `room.localParticipant.publishData()` for send, `room.on(RoomEvent.DataReceived)` for receive, filtered to the `voice-acp` topic.

### 4. Create `RelayChatStream` (`packages/livekit-agent-ganglia/src/relay-stream.ts`)

Extends `llm.LLMStream`. Uses `StreamTransport` for all communication:

- `run()`: publishes JSON-RPC request via transport, starts pondering timer, listens for response messages, emits `ChatChunk` events
- `close()`: sends cancel via transport, calls `super.close()`
- Pondering, onContent, ChatChunk construction follow `AcpChatStream` patterns
- Timeout via `Promise.race` (same pattern as `AcpChatStream`)

### 5. Create `RelayLLM` (`packages/livekit-agent-ganglia/src/relay-llm.ts`)

Extends `llm.LLM`, implements `GangliaLLM`:

- Constructor takes `RelayConfig`, stores room reference
- `chat()` → scans room participants for `relay-*`, throws if not found, creates `DataChannelTransport`, returns new `RelayChatStream`
- `setSessionKey()`, `setDefaultSession()` — same interface as `AcpLLM`
- `gangliaType()` returns `'relay'`
- `aclose()` — no-op (no subprocess to shut down)
- Registers via `registerGanglia('relay', async () => RelayLLM)`

### 6. Update factory (`packages/livekit-agent-ganglia/src/factory.ts`)

Add `room` to `createGangliaFromEnv` opts:

```typescript
export async function createGangliaFromEnv(opts?: {
  logger?: Logger;
  room?: Room;  // Required when GANGLIA_TYPE=relay
  onPondering?: ...;
  onContent?: ...;
}): Promise<GangliaLLM> {
  // ...
  if (type === 'relay') {
    if (!opts?.room) throw new Error('GANGLIA_TYPE=relay requires room in opts');
    return createGanglia({
      type: 'relay',
      relay: {
        room: opts.room,
        logger,
        onPondering: opts?.onPondering,
        onContent: opts?.onContent,
      },
    });
  }
  // ...
}
```

### 7. Update exports (`packages/livekit-agent-ganglia/src/index.ts`)

Export `RelayLLM`, `RelayConfig`, `StreamTransport`, `DataChannelTransport`.

## Not in scope

- Refactoring `AcpChatStream` to use the transport abstraction — it's being retired (task 064f)
- Auto-fallback to ACP if relay not in room — separate stretch goal
- Data channel message chunking — large payloads filtered at relay layer (064b)

## Relates to

- [064 — Relay-Mediated LLM Backend](064-relay-llm-backend.md) (parent design doc)
- [064b — RelayBridge Voice-ACP Handler](064b-relay-bridge-voice-acp.md) (relay-side consumer)
- [064d — Voice-Agent Wiring](064d-voice-agent-wiring.md) (integration point)
- [064f — Remove ACP Backend](064f-remove-acp-backend.md) (follow-up cleanup)

## Acceptance criteria

- [ ] `RelayConfig` added to `GangliaConfig` discriminated union
- [ ] `StreamTransport` interface defined with `sendRequest`, `onMessage`, `sendCancel`
- [ ] `DataChannelTransport` implements `StreamTransport` using LiveKit data channel
- [ ] `RelayChatStream` emits `ChatChunk` events from data channel messages
- [ ] Pondering timer starts on `run()`, clears on first content chunk
- [ ] `onContent(delta, fullText)` fires for each content chunk
- [ ] `close()` sends cancel notification via transport
- [ ] `RelayLLM` implements `GangliaLLM` interface
- [ ] `RelayLLM.chat()` throws if no `relay-*` participant in room
- [ ] `registerGanglia('relay', ...)` in factory
- [ ] `createGangliaFromEnv` with `GANGLIA_TYPE=relay` returns `RelayLLM`
- [ ] `createGangliaFromEnv` with type=relay but no room throws
- [ ] Debug namespaces `ganglia:relay:stream` and `ganglia:relay:client` added
- [ ] **Test T8:** No relay participant → `chat()` throws descriptive error
- [ ] **Test T9:** Happy path: publish request → receive chunks → receive result → ChatChunks emitted
- [ ] **Test T10:** Pondering timer starts, fires phrases, clears on first content
- [ ] **Test T11:** Multiple chunks → `onContent` called with delta and accumulated text
- [ ] **Test T12:** `close()` → publishes cancel on voice-acp
- [ ] **Test T13:** No response within timeout → throws timeout error
- [ ] **Test T14:** JSON-RPC error response from relay → throws with error message
- [ ] **Test T15:** `createGangliaFromEnv({ room })` with `GANGLIA_TYPE=relay` → returns `RelayLLM`
- [ ] **Test T16:** `createGangliaFromEnv()` with type=relay but no room → throws

<!--
Status key:
  [ ]  pending
  [~]  in progress
  [x]  done
  [!]  failed / blocked
-->

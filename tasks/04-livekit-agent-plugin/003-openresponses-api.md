# Task: OpenResponses API Backend (`openresponses`)

## Status: Backlog 📋

> **Not planned for immediate work.** The Chat Completions API provides cross-backend
> portability today. OpenResponses is OpenClaw-specific, so adopting it trades portability
> for richer capabilities. Revisit when the feature gap justifies the tradeoff.

---

## Description

Add an `OpenResponsesLLM` backend to `@knittt/livekit-agent-ganglia` that connects to
OpenClaw via the **OpenResponses API** — OpenClaw's modern, item-based alternative to
Chat Completions.

While Chat Completions models the world as a flat list of `{role, content}` messages,
OpenResponses uses a structured **Item** sequence with granular SSE streaming. This is a
better fit for voice-first, multimodal, and tool-heavy sessions.

### Why OpenResponses Matters for Fletcher

**1. Item-Based Model (not just strings)**
Every turn is an `Item` that can represent audio blobs, image URLs, file attachments, and
tool outputs as distinct, traceable entries. This aligns with how LiveKit and realtime
voice protocols think about the world.

**2. Voice & Realtime Streaming**
OpenResponses emits granular SSE events instead of just text chunks:
- `response.output_item.added`
- `response.content_part.added`
- `response.output_text.delta`

This makes it easier to build UI that shows the agent "thinking" or "typing" while
simultaneously processing voice or tool results — a natural fit for the `ganglia-events`
data channel.

**3. Ephemeral File Handling**
If a user uploads a PDF or image during a voice session, OpenResponses decodes it and
injects it into the system prompt ephemerally. The agent can "see" the file for that turn
without bloating long-term session history.

**4. Client-Side Tooling**
OpenResponses makes it easy to define client-side tools (e.g., "adjust volume", "turn on
lights"). The agent returns a `function_call` item that the Flutter app can execute
locally, without a round-trip through the server.

---

## Phase 1: Research & Design

- [ ] Document the OpenResponses API shape (items, events, session semantics)
- [ ] Map OpenResponses concepts to existing Ganglia abstractions (`GangliaLLM`, `GangliaSessionInfo`, events)
- [ ] Identify gaps: what new types or event kinds are needed?
- [ ] Design the `OpenResponsesLLM` class interface
- [ ] Decide how to handle the item-based model vs. LiveKit's `ChatMessage` format

## Phase 2: Implementation

- [ ] Create `openresponses-client.ts` — HTTP/SSE client for the OpenResponses API
- [ ] Create `openresponses.ts` — `OpenResponsesLLM` class extending `llm.LLM` and implementing `GangliaLLM`
- [ ] Map OpenResponses SSE events to Ganglia event types (`StatusEvent`, `ContentEvent`, `ArtifactEvent`)
- [ ] Register with factory via `registerGanglia('openresponses', ...)`
- [ ] Support `GANGLIA_TYPE=openresponses` env var
- [ ] Handle ephemeral file injection (voice session file uploads)
- [ ] Handle client-side tool definitions and `function_call` item routing

## Phase 3: Flutter Integration

- [ ] Route `function_call` items to Flutter app via `ganglia-events` data channel
- [ ] Add client-side tool execution in Flutter (receive call → execute → return result)
- [ ] Map new SSE event types to UI states (thinking, typing, processing)

## Phase 4: Testing

- [ ] Unit tests for OpenResponses client and LLM class
- [ ] Unit tests for item ↔ ChatMessage mapping
- [ ] Integration test: end-to-end voice conversation via OpenResponses
- [ ] Compare latency and streaming behavior vs. Chat Completions backend

---

## Backend Capability Comparison

| Feature | Chat Completions | OpenResponses |
|---------|-----------------|---------------|
| Text streaming | ✅ | ✅ |
| Tool calls | ✅ | ✅ |
| Granular SSE events | ❌ (text deltas only) | ✅ (item/part/delta) |
| Ephemeral file handling | ❌ | ✅ |
| Client-side tools | ❌ (server-side only) | ✅ |
| Audio/image items | ❌ (text only) | ✅ |
| Cross-backend portable | ✅ | ❌ (OpenClaw only) |

---

## Dependencies

- OpenClaw Gateway must expose the OpenResponses API endpoint
- Existing `GangliaLLM` abstraction and factory system (already in place)
- Flutter `ganglia-events` data channel (already in place)

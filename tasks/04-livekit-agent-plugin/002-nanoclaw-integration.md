# Task: Pluggable Brain Architecture & Nanoclaw Integration

## Description
Refactor the brain plugin to support pluggable backends. Extract a shared interface package, refactor OpenClaw to implement it, then add Nanoclaw as a second backend. The worker should switch between backends via configuration only.

## Key Insight: Nanoclaw's Architecture

Nanoclaw is fundamentally different from OpenClaw:

| Aspect | OpenClaw | Nanoclaw |
|--------|----------|----------|
| API | Exposes `/v1/chat/completions` | No external API |
| Integration model | Plugin/SDK | Claude Code Skills (codebase modification) |
| Multi-user | Yes | Single-user personal assistant |
| Channels | Plugin system | Direct channel implementations |

**Nanoclaw integration requires creating an OpenAI-compatible API layer** via a Claude Code skill (`/add-openai-api`), then Fletcher can call it like OpenClaw.

## Cross-Channel History (Simplified)

Since Nanoclaw is **single-user**, cross-channel history is trivial:

```sql
-- All messages are from the same user, just different channels
SELECT * FROM messages ORDER BY timestamp DESC LIMIT 100
```

Context flows naturally across channels:
```
[WhatsApp 9:00am] "Remind me to call mom tomorrow at 5pm"
[Voice 2:00pm]    "What reminders do I have?"
[Voice 2:00pm]    "You asked me to remind you to call mom tomorrow at 5pm"
```

The API layer just needs to:
1. Store voice messages with `lk:<participant>` JID prefix
2. Load all recent messages (across all channels) as context
3. No user identity mapping needed

---

## Architecture Goal

```
LiveKit Server <--> Fletcher Worker
                         |
                  createBrain(config)  ← livekit-brain-interface
                         |
                    BrainAdapter
                    /          \
           OpenClawLLM      NanoclawLLM
    (livekit-agent-openclaw)  (livekit-agent-nanoclaw)
               |                |
        OpenClaw Gateway   Nanoclaw API Layer
                           (via /add-openai-api skill)
```

## Package Structure

```
packages/
├── livekit-brain-interface/     # Shared types, interfaces, factory
│   ├── src/
│   │   ├── types.ts             # BrainConfig, BrainSessionInfo
│   │   ├── factory.ts           # createBrain()
│   │   └── index.ts
│   └── package.json
├── livekit-agent-openclaw/      # OpenClaw implementation
│   ├── src/
│   │   ├── client.ts
│   │   ├── llm.ts               # OpenClawLLM
│   │   └── index.ts
│   └── package.json             # depends on livekit-brain-interface
└── livekit-agent-nanoclaw/      # Nanoclaw implementation (if needed)
    └── ...                      # May just be config if API is OpenAI-compatible
```

---

## Phase 1: Abstraction ⬅️ START HERE

Create the shared interface package and refactor OpenClaw to use it.

### 1.1 Create `livekit-brain-interface` Package
- [ ] Initialize `packages/livekit-brain-interface` with TypeScript.
- [ ] Create `src/types.ts`:
  ```typescript
  export interface BrainSessionInfo {
    roomName?: string;
    participantIdentity?: string;
    customSessionId?: string;
  }

  export interface OpenClawConfig {
    endpoint: string;
    token: string;
  }

  export interface NanoclawConfig {
    url: string;
    // Nanoclaw is single-user, so no auth token needed (local only)
  }

  export type BrainConfig =
    | { type: 'openclaw'; openclaw: OpenClawConfig }
    | { type: 'nanoclaw'; nanoclaw: NanoclawConfig };
  ```
- [ ] Create `src/factory.ts` with `createBrain(config: BrainConfig): LLM`.
- [ ] Factory dynamically imports implementation packages to avoid hard dependencies.
- [ ] Export all types and factory from `index.ts`.

### 1.2 Refactor `livekit-agent-openclaw`
- [ ] Add dependency on `livekit-brain-interface`.
- [ ] Import types from interface package instead of defining locally.
- [ ] Export `OpenClawLLM` as the implementation.
- [ ] Register with factory (export a `register` function or use convention).
- [ ] Verify existing tests still pass.

### 1.3 Update Worker
- [ ] Update `agent.ts` to import from `livekit-brain-interface`.
- [ ] Use `createBrain()` instead of direct `OpenClawLLM` instantiation.
- [ ] Load config from environment variables (`BRAIN_TYPE`, defaults to `openclaw`).
- [ ] Verify OpenClaw still works end-to-end (regression test).

**Outcome**: OpenClaw works exactly as before, but through the new abstraction layer.

---

## Phase 2: Nanoclaw API Layer

Nanoclaw doesn't expose an API - we need to create one via a Claude Code skill.

### 2.1 Create `/add-openai-api` Skill for Nanoclaw

This skill adds an OpenAI-compatible HTTP endpoint to Nanoclaw:

- [ ] Create skill at `.claude/skills/add-openai-api/SKILL.md` in Nanoclaw repo.
- [ ] Skill adds `src/api/server.ts`:
  - [ ] Express/Hono HTTP server on configurable port.
  - [ ] `POST /v1/chat/completions` endpoint.
  - [ ] SSE streaming response format.
- [ ] Skill adds `src/api/history.ts`:
  - [ ] Load cross-channel message history: `SELECT * FROM messages ORDER BY timestamp DESC LIMIT N`.
  - [ ] Include channel prefix in message metadata for context.
- [ ] Skill modifies `src/index.ts`:
  - [ ] Start API server alongside existing channels.
  - [ ] Store API messages with `lk:<participant>` JID.
- [ ] Document in skill: env vars (`API_PORT`), usage examples.

### 2.2 API Endpoint Specification

```typescript
// Request (OpenAI-compatible)
POST /v1/chat/completions
{
  "model": "nanoclaw",
  "messages": [...],
  "stream": true
}

// Headers for session context
X-Nanoclaw-Channel: "lk:participant-id"

// Response: SSE stream (OpenAI format + extensions)
data: {"id":"...","choices":[{"delta":{"content":"Hello"}}]}
data: {"id":"...","choices":[{"delta":{"content":" world"}}]}
data: [DONE]
```

### 2.3 Extended Events for Voice UX

For long-running operations (file search, web lookup, multi-step reasoning), emit status and artifact events:

```typescript
// Status events - provides feedback during silence
data: {"type":"status","action":"searching_files","detail":"src/**/*.ts"}
data: {"type":"status","action":"reading_file","file":"src/utils.ts"}
data: {"type":"status","action":"web_search","query":"..."}
data: {"type":"status","action":"thinking"}

// Artifact events - visual content, not spoken
data: {"type":"artifact","artifact_type":"diff","file":"src/utils.ts","diff":"@@ -10,3 +10,5 @@..."}
data: {"type":"artifact","artifact_type":"code","language":"typescript","content":"..."}
data: {"type":"artifact","artifact_type":"file","path":"src/utils.ts","content":"..."}

// Content events - spoken via TTS
data: {"type":"content","delta":"I've updated the function."}
```

**Implementation:**
- [ ] Hook into Claude Agent SDK tool execution events.
- [ ] Emit `status` event when tool starts (file read, web search, etc.).
- [ ] Emit `artifact` event for diffs, code blocks, file contents.
- [ ] Emit `content` event for conversational responses (standard OpenAI format).

### 2.4 Cross-Channel Context Loading

When API receives a request:
1. Extract channel JID from header (`lk:alice`)
2. Load recent messages across ALL channels (single-user, so all history is relevant)
3. Format as conversation context for Claude
4. Store response in SQLite with `lk:alice` JID for continuity

**Outcome**: Nanoclaw exposes OpenAI-compatible API with full cross-channel history.

---

## Phase 3: Fletcher Integration

### Key Insight: Fletcher Executes Tools

Fletcher (not the brain) executes tools. This means Fletcher has full access to:
- Tool call requests (what tool, what arguments)
- Tool execution (Fletcher runs them)
- Tool results (actual content)

**This enables visual feedback for BOTH backends**, not just Nanoclaw.

### 3.0 Tool Interception for Visual Feedback (Both Backends)

```typescript
stream.on('tool_call', async (toolCall) => {
  // Status → Data Channel
  publishData({ type: 'status', action: toolCall.name, detail: toolCall.args });

  // Execute
  const result = await executeTool(toolCall);

  // Artifact → Data Channel (if applicable)
  if (toolCall.name === 'read_file') {
    publishData({ type: 'artifact', artifact_type: 'code', ... });
  }
  if (toolCall.name === 'edit_file') {
    publishData({ type: 'artifact', artifact_type: 'diff', ... });
  }

  return result;
});
```

- [ ] Intercept tool calls before execution.
- [ ] Map tool names to status messages (read_file → "Reading...", web_search → "Searching...").
- [ ] Extract artifacts from tool args/results (file content, diffs, search results).
- [ ] Publish status/artifacts via `room.localParticipant.publishData()`.

### 3.1 Event Routing in Fletcher

| Event Type | Source | Destination |
|------------|--------|-------------|
| `content` | SSE stream | TTS (spoken) |
| `status` (server) | SSE stream (Nanoclaw only) | Visualizer + optional TTS |
| `status` (tool) | Tool interception (both) | Data Channel → Flutter |
| `artifact` | Tool interception (both) | Data Channel → Flutter |

- [ ] Route `content` to TTS pipeline (existing behavior).
- [ ] Route server-side `status` events to visualizer (Nanoclaw only).
- [ ] Route tool-based status/artifacts to data channel (both backends).

### 3.2 Flutter Data Channel Handling

- [ ] Subscribe to data channel in Flutter app.
- [ ] Parse status events → show in status bar.
- [ ] Parse artifact events (diff, code, file, search_results).
- [ ] Render diff viewer overlay for code changes.
- [ ] Render code blocks with syntax highlighting.
- [ ] Show search results in expandable list.

### Option A: Reuse OpenClaw Client (Preferred)

If Nanoclaw's API is sufficiently OpenAI-compatible:
- [ ] Add `with_nanoclaw()` factory method to `livekit-brain-interface`.
- [ ] Configure different base_url and headers.
- [ ] No new package needed - just configuration.

### Option B: Separate Nanoclaw Package

If API differences require custom handling:

#### 3.1 Create `livekit-agent-nanoclaw` Package
- [ ] Initialize `packages/livekit-agent-nanoclaw` with TypeScript.
- [ ] Add dependency on `livekit-brain-interface`.

#### 3.2 NanoclawLLM
- [ ] Implement `NanoclawLLM` extending `@livekit/agents` `LLM` class.
- [ ] Handle any Nanoclaw-specific session headers.
- [ ] Map responses to LiveKit `ChatChunk` format.

#### 3.3 Register with Factory
- [ ] Export implementation for factory discovery.
- [ ] Add env vars: `NANOCLAW_URL`, `NANOCLAW_CHANNEL_PREFIX`.

---

## Phase 4: Testing & Validation

### 4.1 Unit Tests
- [ ] `livekit-brain-interface`: Factory tests, type exports.
- [ ] Nanoclaw API skill: Endpoint tests, history loading.

### 4.2 Integration Tests
- [ ] Verify end-to-end voice conversation with OpenClaw (post-refactor).
- [ ] Verify end-to-end voice conversation with Nanoclaw.
- [ ] Test switching between backends via `BRAIN_TYPE` env var only.
- [ ] **Cross-channel test**: Send WhatsApp message, query via voice, verify context.

### 4.3 Performance Validation
- [ ] Measure Nanoclaw API TTFB (target: <500ms).
- [ ] Compare latency between OpenClaw and Nanoclaw backends.
- [ ] Document performance characteristics.

---

## Success Criteria

### Core Integration
- [ ] `livekit-brain-interface` package with shared types and factory.
- [ ] `livekit-agent-openclaw` refactored to use interface.
- [ ] Nanoclaw `/add-openai-api` skill created and working.
- [ ] Worker switches backends via `BRAIN_TYPE` env var.
- [ ] No code changes required to switch backends.
- [ ] Both backends support streaming responses.

### Nanoclaw-Specific
- [ ] Cross-channel history works (voice can see WhatsApp/Telegram context).
- [ ] Nanoclaw latency meets <500ms TTFB target.
- [ ] Server-side status events for non-tool operations.

### Visual Feedback (Both Backends)
- [ ] Tool calls intercepted and surfaced as status events.
- [ ] Tool results (files, diffs) surfaced as artifacts.
- [ ] Status/artifacts sent via LiveKit data channel.
- [ ] Flutter app renders status bar, diff viewer, code blocks.

### Backend Capability Matrix
| Feature | OpenClaw | Nanoclaw |
|---------|----------|----------|
| Content streaming | ✅ | ✅ |
| Tool-based status | ✅ | ✅ |
| Tool-based artifacts | ✅ | ✅ |
| Server-side status | ❌ | ✅ |
| Cross-channel history | ❌ | ✅ |

---

**Technical Spec:** [`docs/specs/04-livekit-agent-plugin/nanoclaw-integration.md`](../../docs/specs/04-livekit-agent-plugin/nanoclaw-integration.md)

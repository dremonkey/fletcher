# Task: Pluggable Brain Architecture & Nanoclaw Integration

## Description
Refactor the brain plugin to support pluggable backends. Create a unified package supporting both OpenClaw and Nanoclaw, switchable via configuration only.

## Current Status: Phase 1-3 Complete, Phase 4 In Progress

---

## Key Insight: Nanoclaw's Architecture

Nanoclaw is fundamentally different from OpenClaw:

| Aspect | OpenClaw | Nanoclaw |
|--------|----------|----------|
| API | Exposes `/v1/chat/completions` | No external API (needs skill) |
| Integration model | Plugin/SDK | Claude Code Skills |
| Multi-user | Yes | Single-user personal assistant |
| Channels | Plugin system | Direct channel implementations |

**Nanoclaw integration requires creating an OpenAI-compatible API layer** via a Claude Code skill (`/add-openai-api`), then Fletcher can call it like OpenClaw.

---

## Package Structure (CURRENT)

After refactoring, there is now a **single unified package**:

```
packages/
└── livekit-agent-ganglia/          # Unified brain plugin
    ├── src/
    │   ├── ganglia-types.ts        # GangliaConfig, GangliaSessionInfo
    │   ├── events.ts               # StatusEvent, ArtifactEvent, ContentEvent
    │   ├── factory.ts              # createGanglia(), registerGanglia()
    │   ├── tool-interceptor.ts     # ToolInterceptor for visual feedback
    │   ├── client.ts               # OpenClawClient (HTTP client)
    │   ├── llm.ts                  # OpenClawLLM (implements GangliaLLM)
    │   ├── nanoclaw-client.ts      # NanoclawClient (HTTP client with JID headers)
    │   ├── nanoclaw.ts             # NanoclawLLM (implements GangliaLLM)
    │   └── index.ts                # Unified exports
    └── package.json                # @knittt/livekit-agent-ganglia
```

---

## Phase 1: Abstraction ✅ COMPLETE

### 1.1 Create Unified Package ✅
- [x] Created types: `GangliaConfig`, `GangliaSessionInfo`, `OpenClawConfig`, `NanoclawConfig`
- [x] Created events: `StatusEvent`, `ArtifactEvent`, `ContentEvent` types and helpers
- [x] Created factory: `createGanglia()`, `createGangliaFromEnv()`, `registerGanglia()`
- [x] Created `ToolInterceptor` for visual feedback during tool execution
- [x] All unit tests passing (129 tests)

### 1.2 Unified Package Structure ✅
- [x] Renamed `livekit-agent-openclaw` → `livekit-agent-ganglia`
- [x] Merged `livekit-ganglia-interface` into `livekit-agent-ganglia`
- [x] `OpenClawLLM` implements `GangliaLLM` interface
- [x] Registered with factory via `registerGanglia('openclaw', ...)`
- [x] Single import for all functionality

**Usage:**
```typescript
import {
  createGanglia,
  createGangliaFromEnv,
  OpenClawLLM,
  NanoclawLLM,
  ToolInterceptor,
  type GangliaConfig
} from '@knittt/livekit-agent-ganglia';

// From environment (GANGLIA_TYPE=openclaw|nanoclaw)
const llm = await createGangliaFromEnv();

// Explicit OpenClaw
const openclawLlm = await createGanglia({
  type: 'openclaw',
  openclaw: { endpoint: 'http://localhost:8080', token: '...' },
});

// Explicit Nanoclaw
const nanoclawLlm = await createGanglia({
  type: 'nanoclaw',
  nanoclaw: { url: 'http://localhost:18789' },
});
```

---

## Phase 2: Nanoclaw API Layer ✅ COMPLETE (Skill Documented)

### 2.1 `/add-openai-api` Skill ✅
- [x] Skill documented at `docs/skills/add-openai-api/SKILL.md`
- [x] Skill adds Hono HTTP server with `/v1/chat/completions` endpoint
- [x] SSE streaming response format (OpenAI-compatible)
- [x] Cross-channel history loading via timestamp query
- [x] Extended events (status, artifact) documented

### 2.2 Next Step: Apply Skill to Nanoclaw
- [ ] Copy skill to Nanoclaw's `.claude/skills/add-openai-api/SKILL.md`
- [ ] Run `/add-openai-api` in Nanoclaw repo
- [ ] Verify API responds at `http://localhost:18789/v1/chat/completions`
- [ ] Test cross-channel history (WhatsApp → Voice context)

---

## Phase 3: Fletcher Integration ✅ COMPLETE

### 3.1 Tool Interceptor ✅ COMPLETE
- [x] `ToolInterceptor` class implemented
- [x] Maps tool names to status actions
- [x] Creates artifacts from tool results (code, diff, search)
- [x] Helper functions: `createReadFileArtifact`, `createEditArtifact`, etc.

### 3.2 NanoclawLLM Implementation ✅ COMPLETE
- [x] `NanoclawLLM` class extending `llm.LLM` and implementing `GangliaLLM`
- [x] `NanoclawClient` with JID-based channel headers (`X-Nanoclaw-Channel`)
- [x] `generateChannelJid()` for session-to-JID mapping
- [x] `extractNanoclawSession()` for LiveKit context extraction
- [x] Registered with factory via `registerGanglia('nanoclaw', ...)`
- [x] Unit tests passing (nanoclaw.spec.ts, nanoclaw-client.spec.ts)

### 3.3 LiveKit Data Channel Publishing ✅ COMPLETE
- [x] Wire `ToolInterceptor` to `room.localParticipant.publishData()` in worker
- [x] Example voice agent script: `scripts/voice-agent.ts`
- [x] `wrapToolsWithInterceptor()` helper to intercept tool execution
- [x] Events published to data channel with topic `ganglia-events`
- [x] NPM scripts: `bun run voice:dev`, `bun run voice:connect --room <name>`
- [ ] Route `content` events to TTS pipeline (handled by @livekit/agents framework)
- [ ] Route `status`/`artifact` events to data channel (done via ToolInterceptor)

### 3.4 Flutter Data Channel Handling ✅ COMPLETE
- [x] Subscribe to data channel in Flutter app (`DataReceivedEvent` listener)
- [x] Parse status events → show in status bar (`StatusBar` widget)
- [x] Parse artifact events → render diff viewer, code blocks (`ArtifactViewer` widget)
- [~] Add syntax highlighting for code artifacts (basic monospace rendering, no syntax highlighting yet)

---

## Phase 4: Testing & Validation

### 4.1 Unit Tests ✅ COMPLETE
- [x] Factory tests passing (including backend registration tests)
- [x] Events tests passing
- [x] Tool interceptor tests passing
- [x] OpenClaw client tests passing
- [x] OpenClaw LLM tests passing
- [x] Nanoclaw client tests passing
- [x] Nanoclaw LLM tests passing

### 4.2 Integration Tests
- [ ] End-to-end voice conversation with OpenClaw
- [ ] End-to-end voice conversation with Nanoclaw
- [ ] Backend switching via `GANGLIA_TYPE` env var
- [ ] Cross-channel context verification

### 4.3 Performance Validation
- [ ] Measure Nanoclaw API TTFB (target: <500ms)
- [ ] Compare latency between backends

---

## Next Steps (Prioritized)

1. ~~**Add NanoclawLLM** - Implement Nanoclaw-specific LLM class with header handling~~ ✅ DONE
2. ~~**Data Channel Wiring** - Connect ToolInterceptor to LiveKit data channel~~ ✅ DONE
3. ~~**Flutter UI** - Add status bar and artifact viewer components~~ ✅ DONE
4. **Apply Nanoclaw Skill** - Copy skill to Nanoclaw repo and run it
5. **Integration Tests** - End-to-end tests with both backends
6. **Syntax Highlighting** - Add code syntax highlighting to artifact viewer (optional)

---

## Success Criteria

### Core Integration
- [x] Unified `livekit-agent-ganglia` package with types, factory, events
- [x] OpenClaw backend working with new structure
- [x] Nanoclaw `/add-openai-api` skill documented
- [x] NanoclawLLM class implemented with JID-based headers
- [x] Backend switching via `GANGLIA_TYPE` env var (code complete, needs e2e test)
- [ ] Nanoclaw backend working end-to-end (needs skill applied to Nanoclaw)

### Visual Feedback
- [x] Tool calls intercepted as status events
- [x] Tool results surfaced as artifacts
- [x] Status/artifacts sent via LiveKit data channel (topic: `ganglia-events`)
- [x] Flutter app renders status bar, diff viewer, code blocks

### Backend Capability Matrix
| Feature | OpenClaw | Nanoclaw |
|---------|----------|----------|
| Content streaming | ✅ | ✅ (pending skill apply) |
| Tool-based status | ✅ | ✅ |
| Tool-based artifacts | ✅ | ✅ |
| Server-side status | ❌ | ✅ |
| Cross-channel history | ❌ | ✅ |
| Proactive outbound | ❌ | ❌ |

**Note:** Both backends are user-initiated only. Neither can proactively "call" the user (e.g., wake-up alarms). See `docs/skills/add-openai-api/SKILL.md` for workarounds.

---

**Technical Spec:** [`docs/specs/04-livekit-agent-plugin/nanoclaw-integration.md`](../../docs/specs/04-livekit-agent-plugin/nanoclaw-integration.md)
**Skill Documentation:** [`docs/skills/add-openai-api/SKILL.md`](../../docs/skills/add-openai-api/SKILL.md)

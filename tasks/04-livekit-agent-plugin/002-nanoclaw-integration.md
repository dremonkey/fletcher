# Task: Pluggable Brain Architecture & Nanoclaw Integration

## Description
Refactor the brain plugin to support pluggable backends. Create a unified package supporting both OpenClaw and Nanoclaw, switchable via configuration only.

## Current Status: Phase 1-2 Complete, Phase 3-4 In Progress

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
    │   ├── client.ts               # HTTP client (works for both backends)
    │   ├── llm.ts                  # OpenClawLLM (implements GangliaLLM)
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
- [x] All unit tests passing (86 tests)

### 1.2 Unified Package Structure ✅
- [x] Renamed `livekit-agent-openclaw` → `livekit-agent-ganglia`
- [x] Merged `livekit-ganglia-interface` into `livekit-agent-ganglia`
- [x] `OpenClawLLM` implements `GangliaLLM` interface
- [x] Registered with factory via `registerGanglia('openclaw', ...)`
- [x] Single import for all functionality

**Usage:**
```typescript
import {
  createGangliaFromEnv,
  OpenClawLLM,
  ToolInterceptor,
  type GangliaConfig
} from '@knittt/livekit-agent-ganglia';

const llm = await createGangliaFromEnv(); // Uses GANGLIA_TYPE env var
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

## Phase 3: Fletcher Integration 🔄 IN PROGRESS

### 3.1 Tool Interceptor ✅ COMPLETE
- [x] `ToolInterceptor` class implemented
- [x] Maps tool names to status actions
- [x] Creates artifacts from tool results (code, diff, search)
- [x] Helper functions: `createReadFileArtifact`, `createEditArtifact`, etc.

### 3.2 LiveKit Data Channel Publishing ⬅️ NEXT
- [ ] Wire `ToolInterceptor` to `room.localParticipant.publishData()` in worker
- [ ] Route `content` events to TTS pipeline
- [ ] Route `status`/`artifact` events to data channel

### 3.3 Flutter Data Channel Handling
- [ ] Subscribe to data channel in Flutter app
- [ ] Parse status events → show in status bar
- [ ] Parse artifact events → render diff viewer, code blocks
- [ ] Add syntax highlighting for code artifacts

---

## Phase 4: Testing & Validation

### 4.1 Unit Tests
- [x] Factory tests passing
- [x] Events tests passing
- [x] Tool interceptor tests passing
- [x] Client tests passing

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

1. **Apply Nanoclaw Skill** - Copy skill to Nanoclaw repo and run it
2. **Add NanoclawLLM** - Implement Nanoclaw-specific LLM class with header handling
3. **Data Channel Wiring** - Connect ToolInterceptor to LiveKit data channel
4. **Flutter UI** - Add status bar and artifact viewer components

---

## Success Criteria

### Core Integration
- [x] Unified `livekit-agent-ganglia` package with types, factory, events
- [x] OpenClaw backend working with new structure
- [x] Nanoclaw `/add-openai-api` skill documented
- [ ] Nanoclaw backend working end-to-end
- [ ] Backend switching via `GANGLIA_TYPE` env var

### Visual Feedback
- [x] Tool calls intercepted as status events
- [x] Tool results surfaced as artifacts
- [ ] Status/artifacts sent via LiveKit data channel
- [ ] Flutter app renders status bar, diff viewer, code blocks

### Backend Capability Matrix
| Feature | OpenClaw | Nanoclaw |
|---------|----------|----------|
| Content streaming | ✅ | ✅ (pending skill apply) |
| Tool-based status | ✅ | ✅ |
| Tool-based artifacts | ✅ | ✅ |
| Server-side status | ❌ | ✅ |
| Cross-channel history | ❌ | ✅ |

---

**Technical Spec:** [`docs/specs/04-livekit-agent-plugin/nanoclaw-integration.md`](../../docs/specs/04-livekit-agent-plugin/nanoclaw-integration.md)
**Skill Documentation:** [`docs/skills/add-openai-api/SKILL.md`](../../docs/skills/add-openai-api/SKILL.md)

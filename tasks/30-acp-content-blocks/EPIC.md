# Epic 30: ACP Content Blocks

**Goal:** Replace Fletcher's custom artifact model with ACP-native ContentBlock types. Collapse the dual artifact pipeline into a single path: the relay forwards ACP tool-call content to mobile in both voice and text mode. Enable MIME-type-dispatched rendering supporting text, images, audio, embedded resources, resource links, and diffs.

**Problem:** Fletcher has two independent artifact pipelines that diverged from the ACP spec. Text mode uses a near-ACP path (relay → mobile on `acp` topic), but only extracts text. Voice mode uses a custom path (Ganglia ToolInterceptor → `ganglia-events` topic). Both are text-only, use a closed `ArtifactType` enum, and require 5-6 file changes to add a new content type.

**Solution:** One pipeline. The relay is the single source of ACP content for mobile — in both voice and text mode. Mobile always subscribes to `acp` and renders content via a MIME-dispatched `RendererRegistry`. Ganglia's artifact pipeline (ToolInterceptor, EventInterceptor, custom events) and Nanoclaw backend are deleted.

## Architecture

```
ACP Agent (subprocess)
    |
    | stdio JSON-RPC
    v
Relay
    |
    +-- voice-acp topic → Voice Agent (text tokens for TTS only)
    |
    +-- acp topic ----→ Mobile (ALL content: messages, tool calls, diffs)
    |                    (dual-published in voice mode via participant check)
    v
Voice Agent
    |
    +-- ganglia-events → Mobile (voice control only: hold, tts-mode,
                                  pondering, transcription, pipeline_info)

Mobile ACP Client
    |
    | AcpUpdateParser (acp topic — runs in both modes)
    |   +-- agent_message_chunk.content → ContentBlock → RendererRegistry
    |   +-- tool_call → StatusBar (kind/title/status) + ToolCallCard
    |   +-- tool_call_update.content[] → ContentBlock[] → RendererRegistry
    |   +-- agent_thought_chunk → ThinkingBlock (unchanged)
    |
    | ganglia-events handler (voice control only — no content)
    |   +-- pondering → ThinkingSpinner
    |   +-- session_hold / tts-mode / pipeline_info → existing handlers
    |   +-- agent_transcript / user_transcript → subtitle display
    v
ContentBlock sealed class
    |
    | type + mimeType dispatch
    v
RendererRegistry: Map<pattern, RendererFactory>
    +-- DiffContent    → DiffRenderer (structural dispatch)
    +-- text/markdown  → MarkdownRenderer
    +-- text/*         → TextRenderer / CodeRenderer
    +-- image/*        → ImageRenderer
    +-- audio/*        → AudioRenderer
    +-- ResourceLink   → ResourceLinkCard (structural dispatch)
    +-- */* fallback   → RawJsonRenderer
```

## Status

**Epic Status:** [ ]

## Tasks

### Phase 1: Relay Pipeline Unification

### T30.01: Relay Dual-Publish in Voice Mode
Make relay publish ACP session/update to mobile on acp topic during voice-mode sessions (not just text mode). Uses participant check to detect voice mode.

**Status:** [ ]

---

### T30.02: Derive Status from ACP Tool Call
StatusBar reads kind/title/status from ACP tool_call events instead of Ganglia StatusEvent.

**Status:** [ ]

---

### T30.03: Mobile Relay-First in Both Modes
Mobile sends typed text via relay (session/prompt) in both modes. RelayChatService subscribes to acp topic in both modes. Removes text_message from ganglia-events. (Merges original T30.03 + T30.04.)

**Status:** [ ]

---

### Phase 2: ContentBlock Model + Registry

### T30.05: ContentBlock Sealed Class
Dart sealed class hierarchy for all ACP content block types — replaces ArtifactEvent/ArtifactType.

**Status:** [ ]

---

### T30.06: Widen ContentPart in acp-client
ContentPart becomes a discriminated union supporting text, image, audio, resource, resource_link. Adds ToolCallContent types.

**Status:** [ ]

---

### T30.07: RendererRegistry with MIME Dispatch
Map<pattern, RendererFactory> with MIME-pattern matching. Replaces _ArtifactContent switch.

**Depends on:** T30.05

**Status:** [ ]

---

### T30.08: AcpUpdateParser Emits ContentBlock
Widen parser to emit ContentBlock for all ACP content types (not just text). Handles tool_call_update content arrays.

**Depends on:** T30.05, T30.06

**Status:** [ ]

---

### Phase 3: Renderer Migration + Cleanup

### T30.09: Port Renderers to ContentBlock
Port Diff, Code, Markdown renderers to ContentBlock input. Drop SearchResultsViewer (plain text is acceptable). Register with RendererRegistry.

**Depends on:** T30.05, T30.07

**Status:** [ ]

---

### T30.10: Delete Mobile Legacy Artifacts
Delete ArtifactEvent, ArtifactType, ganglia-events content handlers (artifact, status), showArtifactDrawer(), deprecated RoomNameGenerator.generate().

**Depends on:** T30.02, T30.03, T30.08, T30.09

**Status:** [ ]

---

### T30.11: Gut Ganglia
Delete ToolInterceptor, EventInterceptor, custom artifact types, Nanoclaw backend, historyMode, BRAIN_TYPE. Remove EventInterceptor from voice agent. Package retains: RelayLLM, SessionKey, factory, transport, types.

**Depends on:** T30.10

**Status:** [ ]

---

### T30.12: Delete Deprecated Relay Stubs
Remove scheduleRemoveRoom(), cancelPendingTeardown(), hasPendingTeardown(), getPendingTeardowns() from BridgeManager.

**Status:** [ ]

---

### Phase 4: Binary Content Rendering

### T30.13: Relay Payload Chunking
Port EventInterceptor's chunking pattern to relay forwardToMobile/forwardToVoiceAgent for payloads >15KB. Add mobile-side reassembly for relay topic. Include stale-transfer timeout.

**Depends on:** T30.01

**Status:** [ ]

---

### T30.14: ImageRenderer
Image.memory() with isolate-based base64 decode, 5MB size cap, loading/error states. Registered for image/*.

**Depends on:** T30.07, T30.08, T30.13

**Status:** [ ]

---

### T30.15: AudioRenderer
Metadata card with play button for audio content blocks. Registered for audio/*.

**Depends on:** T30.07, T30.08, T30.13

**Status:** [ ]

---

### T30.16: ResourceLinkCard
Metadata display (name, mimeType, size). Fetch deferred to Epic 31. Registered via structural dispatch.

**Depends on:** T30.07, T30.08

**Status:** [ ]

---

### Deferred

### T30.17: Chart/Timeseries Renderer
**Deferred:** No ACP agent emits chart data yet. Revisit when agent support arrives.

**Status:** [ ]

---

### T30.18: PDF Renderer
**Deferred:** No ACP agent emits PDF content. Revisit when agent support arrives.

**Status:** [ ]

---

### T30.19: Video Renderer
**Deferred:** No ACP agent emits video content. Revisit when agent support + streaming infra arrives.

**Status:** [ ]

---

### T30.20: Text Input + Voice Output Mode
**Deferred:** Third interaction mode (keyboard input, spoken responses). Relay dual-publish infra is ready; needs voice agent unsolicited listener + mobile three-state mode selector. Revisit on user demand.

**Status:** [ ]

---

### T30.21: Voice Agent Unsolicited Response TTS
**Deferred:** Passive voice-acp listener feeding relay-originated responses to AgentSession.say(stream). Requires T30.20.

**Depends on:** T30.20

**Status:** [ ]

## Key Decisions

1. **One pipeline, not two.** The relay is the single source of ACP content for mobile. Ganglia's artifact pipeline is deleted.
2. **MIME-type dispatch, not enum.** Renderers register against MIME patterns. New content types are a single registration.
3. **Breaking change.** No adapter layers. Legacy code is deleted, not wrapped.
4. **Voice agent becomes audio-only.** It extracts text tokens for TTS from the relay's `voice-acp` responses. It no longer generates or publishes artifacts.
5. **Status from ACP tool_call.** The StatusBar derives status from ACP `tool_call` events instead of Ganglia `StatusEvent`.
6. **Ganglia stays as a package, but focused.** RelayLLM + SessionKey routing + slim factory. Everything else deleted.
7. **Two modes for now.** Text-only and voice-only. Text-input + voice-output (mode 3) deferred — infrastructure is forward-compatible.
8. **Voice mode detection via participant check.** Relay detects voice mode by checking for voice-agent participant, not mode flags.
9. **T30.03 + T30.04 merged.** Send and subscribe are one concern: "mobile uses relay as sole ACP path."
10. **Drop SearchResultsViewer.** Search results arrive as plain text — no smart ripgrep detection. Plain text rendering is acceptable.
11. **Relay-side chunking for large payloads.** Port EventInterceptor pattern to relay for Phase 4 image delivery. 14KB chunks with stale-transfer timeout.

## Anti-Goals

- **No adapter layers.** Do not wrap legacy `ArtifactEvent` in a `ContentBlock` adapter. Delete the old model.
- **No TTS for typed text (yet).** Voice agent does not speak responses to relay-originated prompts. Deferred to T30.20/T30.21.
- **No smart search result detection.** Don't parse ripgrep output format. Plain text is fine.
- **No Phase 5 renderers.** Chart, PDF, video renderers are deferred until ACP agents emit those content types.
- **No mode 3 UI.** Mobile has two modes (text-only, voice-only). Three-state selector deferred.

## NOT in scope

| Item | Rationale |
|---|---|
| Chart/PDF/video renderers (T30.17-19) | No ACP agent emits these content types |
| Text-input + voice-output mode (T30.20) | Scope reduction — two modes sufficient |
| Unsolicited response TTS (T30.21) | Depends on mode 3 |
| Smart search result parsing | Output format depends on agent, not us |
| Image zoom/pan | Enhancement, not core |
| Audio streaming/waveform | Enhancement, not core |
| Resource fetching/download | Epic 31 (Resource Delivery) |
| Compression for chunked payloads | Chunking alone sufficient for Phase 4 sizes |

## What already exists

| Sub-problem | Existing code | Reuse? |
|---|---|---|
| Relay forwards all ACP events | `relay-bridge.ts:196-248` — `onUpdate()` receives all session/update | Yes — add second publish call |
| Mobile parses ACP tool_call | `acp_update_parser.dart` emits `AcpToolCallUpdate` | Yes — add status extraction |
| Mobile parses text content | `AcpUpdateParser` handles `agent_message_chunk` text | Yes — widen to all types |
| Text-mode relay routing | `RelayChatService` sends `session/prompt` via relay | Yes — use in both modes |
| ContentPart type | `acp-client/types.ts:161-164` | Yes — widen to union |
| Artifact renderers | `artifact_viewer.dart` — Diff, Code, Markdown, Error | Port to ContentBlock input |
| StatusBar widget | Renders status from ganglia-events | Re-source from tool_call |
| Chunk reassembly | `livekit_service.dart:1087-1122` — ganglia-events chunks | Port pattern to relay topic |

## Dependencies

- ACP protocol spec (local copy at `docs/specs/acp-protocol/`)
- `packages/acp-client` — types need widening
- Epic 22 (Dual-Mode) — relay path is primary
- Epic 24 (WebRTC ACP Relay) — relay must support dual-publish
- Epic 31 (Resource Delivery) — `resource_link` fetch + CDN delivery (Phase 4 ResourceLinkCard degrades gracefully without it)

## References

- `docs/specs/acp-protocol/content.md` — ACP content block spec
- `docs/specs/acp-protocol/tool-calls.md` — tool call content types
- `docs/specs/acp-protocol/schema.md` — full schema definitions

## Success Criteria

- [ ] Mobile receives tool-call content from relay in both voice and text mode
- [ ] ACP `image` content renders on mobile (base64 inline)
- [ ] ACP `resource` (text + blob) content renders with MIME-appropriate widget
- [ ] ACP `diff` from tool_call_update renders in DiffRenderer
- [ ] Adding a new MIME-type renderer requires 1 file change (registration + widget)
- [ ] Ganglia contains only: RelayLLM, SessionKey routing, factory, types, public API
- [ ] No Nanoclaw code in the codebase
- [ ] No ArtifactEvent / ArtifactType in the codebase
- [ ] No ToolInterceptor / EventInterceptor in the codebase
- [ ] No deprecated BridgeManager stubs in relay
- [ ] 80%+ test coverage on ContentBlock parsing and MIME dispatch

<!--
Status key:
  [ ]  pending / backlog
  [~]  in progress
  [x]  done
  [!]  blocked
-->

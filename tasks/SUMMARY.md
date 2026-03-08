# Fletcher Project Roadmap

Fletcher is a high-performance voice-first bridge for OpenClaw using LiveKit.

## Architecture

Fletcher is a **standalone voice agent** that connects to the OpenClaw Gateway via its OpenAI-compatible completions API. It runs as an independent LiveKit worker, handling the complete audio pipeline (STT → LLM → TTS) outside the Gateway process.

> We initially explored building Fletcher as an OpenClaw channel plugin (running inside the Gateway, like Telegram/WhatsApp channels) but opted for the standalone approach — simpler to develop, deploy, and debug. See [Architecture Comparison](../docs/architecture-comparison.md) for the full analysis.

## Epics

### 1. [Infrastructure](./01-infrastructure) ✅
Setting up the development environment, LiveKit server, and monorepo structure.

**Tasks:**
- [x] 001: Setup LiveKit server (local or cloud)
- [x] 002: Repository structure & CI/CD
- [x] 003: Bootstrap script (cross-platform)
- [ ] 004: Remote Reboot "Hail Mary" Fallback 📋

### 2. [Voice Agent Pipeline](./02-livekit-agent) 🔄
The voice agent audio pipeline — STT, TTS, voice detection, and agent dispatch.

**Tasks:**
- [x] 003: Debug voice agent not responding ✅ — fixed via auto-dispatch (agentName + roomConfig in token)
- [x] 005: Token generation endpoint (Sovereign Pairing) ✅
- [ ] 007: Noise-Robust Voice Detection 📋
- [~] 008: Immediate Acknowledgment 🔄 — Phases 1-2 complete: looping two-note chime on EOU via BackgroundAudioPlayer (1.5s gap between repetitions); Phase 3 (client visual pairing) open ([BUG-006](../docs/field-tests/20260301-buglog.md))
- [ ] 009: TTS Empty Chunk Guard 📋 — buffer initial TTS input to avoid Cartesia rejecting punctuation-only chunks ([BUG-005](../docs/field-tests/20260301-buglog.md))
- [ ] 010: Fix Agent Dispatch in `dev` Mode 📋 — worker registers but LiveKit never dispatches jobs; `connect --room` workaround ([BUG-007](../docs/field-tests/20260301-buglog.md))
- [ ] 011: Voice Selection Persistent Preferences 📋 — selection UI/API with persistent storage and env-var based config
- [~] 012: Agent Self-Terminate on Session Error 🔄 — Priority: prevent zombie agents; disconnect from room when session dies
- [ ] 013: Voice-Aware Metadata Tagging 📋 — inject `is_stt: true` into metadata sent to OpenClaw to enable higher verification thresholds for noisy inputs
- [~] 015: Tiered Edge TTS Prototype 🔄 — PiperTTS plugin + FallbackAdapter wired; Piper sidecar in docker-compose; UX feedback artifact remaining
- [ ] 016: Buffer Catch-Up Optimization 📋 — Research accelerated PCM playout and transcript-only catch-up to sync conversation after blackouts
- [ ] 017: Voice Agent Memory Leak (RCA) 📋 — root-cause analysis for 7.4 GB leak; see 018 and 019 for implementation ([BUG-004](../docs/field-tests/20260305-buglog.md))
- [ ] 018: Upstream `_AudioOut.audio` Memory Leak 📋 — file issue + PR on `livekit/agents-js`: `out.audio.push(frame)` in `generation.ts` accumulates all TTS frames, never cleared
- [~] 019: Internal Memory Leak Mitigations 🔄 — `knownStreamIds` cleanup, OTel span leak patch, Docker 4G limit, heap snapshot mechanism; pending field verification
- [~] 014: Human-Centric Interruption Handling 🔄 — Phase 1 complete: fixed endpointing delay units bug (0.8→800ms), increased `minInterruptionDuration` to 800ms, added `minInterruptionWords: 1` to reduce false interruptions; Phase 2-3 (ack sound edge cases, soft TTS fade) deferred pending field testing
- [x] 014: TTS Error Graceful Degradation ✅ — `maxUnrecoverableErrors: Infinity` prevents session death; `ttsConnOptions: { maxRetry: 0 }` eliminates 429 retry storms; debounced "Voice Unavailable" artifact sent to client ([BUG-024](../docs/field-tests/20260304-buglog.md))

**Implemented:**
- VoiceAgent wired to `@livekit/agents` SDK (deepgram.STT, cartesia.TTS, voice.AgentSession)
- Ganglia LLM as brain via `@knittt/livekit-agent-ganglia`
- STT/TTS provider interfaces and factory functions

**Remaining:**
- Full audio track subscription and chunk publishing
- Latency monitoring and metrics

### 3. [Flutter App](./03-flutter-app) 🔄
The mobile client for real-time voice interaction and visualization.

**Tasks:**
- [x] 001: Initialize Flutter app ✅
- [x] 002: Implement Amber Heartbeat visualizer ✅
- [~] 003: Voice activity indicator & real-time STT display — audio waveform + STT subtitle + transcript drawer implemented; e2e UI tests passing; [BUG-013] Transcript UI stale when panel open; [BUG-014] Premature EOU detection
- [ ] 004: Fix `addTransceiver: track is null` During Reconnect 📋 — null track reference during `rePublishAllTracks` after rapid reconnect cycles ([BUG-025](../docs/field-tests/20260303-buglog.md))
- [ ] 005: SQLite Local Persistence for Chat Transcript 📋 — messages/artifacts cleared on app restart; need local SQLite storage ([BUG-016](../docs/field-tests/20260307-buglog.md))

**Implemented:**
- Full Flutter app with livekit_client integration
- AmberOrb visualizer with all conversation states
- Real-time audio level monitoring via Participant.audioLevel (100ms polling)
- Audio waveform visualization (CustomPainter with rolling buffer)
- Real-time STT subtitle overlay with TranscriptionEvent handling
- Transcript drawer (chat-style, follows ArtifactDrawer pattern)
- Mute toggle, auto-connect, dark theme
- Ganglia data channel subscription (`ganglia-events` topic)
- StatusBar widget showing agent actions (reading, searching, editing)
- ArtifactViewer for diffs, code blocks (with Markdown support), search results, errors

### 4. [Standalone Brain Plugin](./04-livekit-agent-plugin) 🔄
A unified LLM plugin (`@knittt/livekit-agent-ganglia`) that bridges LiveKit agents to OpenClaw or Nanoclaw via OpenAI-compatible API.

**Tasks:**
- [~] 001: Standalone Brain Plugin — OpenClaw working, unit tests passing; advanced features (async tools, context injection) and documentation remaining
- [~] 002: Nanoclaw Integration — Phase 1-3 complete, Phase 4 (integration tests) in progress
- [ ] 003: OpenResponses API Backend — backlog; item-based alternative to Chat Completions with granular SSE, ephemeral files, client-side tools
- [x] 004: Session Key Routing (spec 08) ✅ — identity-based session routing replaces room-scoped IDs; owner/guest/room routing for both OpenClaw and Nanoclaw; 35 new tests
- [ ] 005: End-to-End OpenClaw Integration — validate full voice pipeline against real Gateway; session continuity, guest isolation, tool calling
- [x] 006: Standardize on Google TTS ✅ — Replaced ElevenLabs/Cartesia; using Google TTS for "Clutch" personality character delivery.
- [ ] 007: Handle "Queue is closed" Gracefully 📋 — catch queue-closed error during user interruption instead of propagating as fatal llm_error ([BUG-019](../docs/field-tests/20260302-buglog.md))
- [ ] 008: Fix Zombie Agent on Disconnect 📋 — ensure agent disconnects from room when AgentSession dies or user leaves ([BUG-020](../docs/field-tests/20260302-buglog.md))
- [ ] 016: Explicit Turn Cancellation & Lane Management 📋 — use AbortController to unlock OpenClaw session lanes after network drops

**Implemented:**
- Unified `@knittt/livekit-agent-ganglia` package with types, factory, events, tool-interceptor
- `OpenClawLLM` implementation with auth, sessions, message mapping
- `NanoclawLLM` implementation with JID-based channel headers
- Backend switching via `GANGLIA_TYPE` env var (openclaw | nanoclaw)
- **Session key routing** per spec 08: `resolveSessionKey()`, `SessionKey` type, owner/guest/room routing
- Voice agent wires `FLETCHER_OWNER_IDENTITY` → `resolveSessionKeySimple()` → `setSessionKey()`
- `/add-openai-api` skill documented for Nanoclaw (needs to be applied)
- `ToolInterceptor` for visual feedback (status events, artifacts)
- Flutter UI: `StatusBar` widget and `ArtifactViewer` (diff, code, search results)
- Data channel subscription for `ganglia-events` topic
- 162 unit tests passing

**Remaining:**
1. **E2E OpenClaw integration (005)** — validate against real Gateway
2. Apply `/add-openai-api` skill to Nanoclaw repo
3. Integration tests with Nanoclaw backend
4. Error handling and retry tests (network failures, rate limits)
5. Async tool resolution support
6. Context injection (LiveKit room metadata → OpenClaw context)
7. Package README and documentation
8. CI/CD for npm publishing

### 5. [Latency Optimization](./05-latency-optimization) 📋
Pipeline optimizations to reduce voice-to-voice latency from ~1.4s to <0.8s.

**Tasks:**
- [ ] 001: Enable preemptive generation & tune endpointing (Phase 1)
- [x] 002: Add latency instrumentation & metrics — moved to [Epic 10: Metrics](./10-metrics)
- [ ] 003: Streaming interim transcripts to LLM (Phase 2)
- [ ] 004: TTS pre-warming validation (Phase 3)
- [~] 005: Investigate & reduce OpenClaw TTFT 🔄 — Phase 1 complete: pondering status phrases + looping chime fill silence during thinking; Phase 2 (vocalized inner monologue) deferred ([BUG-006](../docs/field-tests/20260301-buglog.md))

**Baseline measurement (2026-03-01 field test):** ~8-10s perceived latency. LLM TTFT is ~8s, pipeline overhead ~528ms.

**Spec:** [docs/specs/05-latency-optimization/spec.md](../docs/specs/05-latency-optimization/spec.md)

### 6. [Voice Fingerprinting (Sovereign ID)](./06-voice-fingerprinting) 📋
Local-first voice identification and context injection.

**Tasks:**
- [ ] 001: Research & Prototype (Spike)
- [ ] 002: Core Library Implementation (`@fletcher/voice-key`)
- [ ] 003: LiveKit Integration
- [ ] 004: Context Injection
- [ ] 005: Enrollment UI/Flow

**Spec:** [docs/specs/06-voice-fingerprinting/spec.md](../docs/specs/06-voice-fingerprinting/spec.md)

### 7. [Sovereign Pairing](./07-sovereign-pairing) 🔄
Secure handshake between Fletcher and Heirloom Hub (OpenClaw).

**Tasks:**
- [x] 001: Create Protocol Specification ✅
- [x] 002: Implement Token Endpoint (`/fletcher/token`) ✅
- [x] 003: Integrate with LiveKit Channel Plugin ✅
- [ ] 004: Vessel Key Specification 📋 — JSON payload for full Hub config (Tailscale, Gateway, Identity)
- [ ] 007: "Fletcher Bridge" OpenClaw Skill 📋 — Server-side skill for Vessel Key generation and context bootstrapping
- [ ] 005: "Blank Slate" Bootloader UI 📋 — First-run experience for App Store users
- [ ] 006: Camera-based Handshake 📋 — QR/OCR pairing from Hub terminal

**Spec:** [docs/specs/07-sovereign-pairing.md](../docs/specs/07-sovereign-pairing.md)

### 8. [Security](./08-security) 📋
Hardening secrets management, auth, and dev environment security.

**Tasks:**
- [ ] 001: Generate LiveKit API secret at setup time — remove hardcoded secret from `livekit.yaml`, generate per-developer at bootstrap
- [ ] 002: Explicit Identity in Session Routing — fix "guest_user" anonymity by passing `user` ID from Fletcher to OpenClaw API
- [ ] 003: Multi-User Privacy Guard — implement "Restricted Mode" for non-owners (e.g., family/guests) to prevent personal memory leaks

### 9. [TUI Improvements](./tui) 🔄
Developer experience improvements to the terminal UI launcher.

**Tasks:**
- [~] 001: `fletcher tui` CLI entrypoint — code complete, needs manual verification
- [x] 002: Reliable one-shot service startup — fixed registration log string, Docker CPU load dispatch bug ([agents-js#1082](https://github.com/livekit/agents-js/issues/1082)), ganglia config mismatch; tested on emulator + Pixel 9
- [~] 003: Graceful Ctrl+C shutdown — Bun signal handler bug workaround + sync cleanup working; Ctrl+C during startup and double Ctrl+C untested

### 9. [Connectivity & Resilience](./09-connectivity) 🔄
Bulletproof connection handling: survive network switches, Bluetooth changes, airplane mode, and phone sleep.

**Tasks:**
- [x] 001: Hook into LiveKit SDK reconnection events — show "Reconnecting..." during SDK's own 10-attempt recovery window
- [x] 002: Filter DisconnectReason before auto-reconnect — prevent infinite loops and fighting user intent
- [x] 003: Add network connectivity monitoring — `connectivity_plus` for online/offline awareness
- [x] 004: Network-aware reconnection strategy — pause retries while offline, resume on network restore
- [x] 005: Preserve app state across reconnects — transcripts, artifacts, mute state survive reconnection
- [x] 006: Tailscale ICE negotiation fix — pin server's Tailscale IP for stable 5G/Wi-Fi transitions ✅
- [x] 007: WiFi → 5G ICE renegotiation failure — increased `departure_timeout` to 120s so room survives the 40-80s handoff (BUG-015) ✅
- [~] 008: Tailscale-aware URL resolution — runtime detection of Tailscale VPN on phone, auto-selects correct URL; code complete, needs user testing
- [x] 009: Bluetooth audio route recovery — `restartTrack()` swaps audio source without unpublishing ✅ ([BUG-004](../docs/field-tests/20260301-buglog.md))
- [ ] 010: Diagnostics Stale After Reconnect 📋 — HealthService doesn't re-enumerate participants after DUPLICATE_IDENTITY reconnect ([BUG-016](../docs/field-tests/20260302-buglog.md))
- [ ] 011: Network Transition Audio Track Timeout 📋 — WiFi→cellular causes 55s audio track publish delay (Tailscale tunnel re-establishment) + BT audio route disruption ([BUG-021](../docs/field-tests/20260303-buglog.md))
- [ ] 012: Foreground Service for Background Microphone 📋 — Android 14+ silences mic within 5s of backgrounding; add `FOREGROUND_SERVICE_MICROPHONE` to keep voice session alive in pocket ([BUG-022](../docs/field-tests/20260303-buglog.md))
- [~] 013: Client-Side Audio Buffering 🔄 — switched from broken `AudioCaptureService` stub to SDK's `PreConnectAudioBuffer`; mic audio captured natively during SDK reconnect and sent to agent via `streamBytes()` on reconnection (BUG-027). Remaining: verify agent-side handles `lk.agent.pre-connect-audio-buffer` topic. See [013-audio-buffering-plan.md](./09-connectivity/013-audio-buffering-plan.md).
- [x] 017: Time-Budgeted Reconnect ✅ — extend client retry window from ~71s to match server departure_timeout (130s); two-phase strategy: 5 fast retries + slow 10s poll until budget expires; budget clock starts on first SDK reconnect attempt; verified via e2e test 008 ([BUG-028](../docs/field-tests/20260304-buglog.md))
- [~] 018: Fix URL Resolver VPN Detection 🔄 — TCP race between LAN and Tailscale URLs (Option A); replaces broken "always use Tailscale" approach; needs field test ([BUG-031](../docs/field-tests/20260304-buglog.md), [BUG-004](../docs/field-tests/20260306-buglog.md))
- [~] 019: Background Session Timeout & App-Close Disconnect 🔄 — implemented: `stopWithTask="true"` for swipe-away disconnect, screen lock detection via method channel, 10-min background timeout with notification countdown; pending field verification
- [ ] 020: Agent Reconnect After Worker Restart 📋 — LiveKit doesn't re-dispatch agent jobs after worker restart; orphaned rooms with users but no agent ([BUG-005](../docs/field-tests/20260306-buglog.md))
- [x] 021: Dynamic Room Names ✅ — dynamic `fletcher-<timestamp>` room names with token endpoint; client creates new room on budget exhaustion for seamless agent restart recovery; e2e tests 006-008 passing ([BUG-005](../docs/field-tests/20260306-buglog.md))
- [~] 022: E2E Test Room Convention 🔄 — `e2e-fletcher-` prefix when `E2E_TEST_MODE=true`; agent detects `e2e-*` rooms and uses minimal prompt; pending field verification
- [ ] 023: Background Auto-Close Timer Regression 📋 — 10-min background timeout not firing on app switch; regression of task 019 ([BUG-028](../docs/field-tests/20260307-buglog.md))

**Depends on:** Epic 3 (Flutter App)

### 10. [Metrics & Observability](./10-metrics) ✅
OpenTelemetry-compatible instrumentation for the voice pipeline. Measure STT, EOU, LLM TTFT, TTS TTFB, and total round-trip latency per turn.

**Tasks:**
- [x] 001: Wire up AgentSession metric events (pino logging) ✅
- [x] 002: HTTP-layer timing in Ganglia (performance.now) ✅
- [x] 003: OpenTelemetry exporter setup (opt-in OTLP) ✅
- [x] 004: Per-turn metrics collector (speechId correlation) ✅

**Implemented:**
- `MetricsCollected`, `AgentStateChanged`, `UserInputTranscribed` event listeners in voice-agent
- `performance.now()` timing in Ganglia's `client.ts` (fetch→firstChunk→complete) and `llm.ts` (stream timing)
- Opt-in OTel tracing via `OTEL_EXPORTER_OTLP_ENDPOINT` with `NodeTracerProvider` + `BatchSpanProcessor`
- `TurnMetricsCollector` correlating EOU + LLM + TTS by `speechId` into per-turn summaries
- 5 unit tests for metrics collector

### 11. [UI Redesign — TUI Brutalist](./07-ui-ux) 🔄
Complete UI redesign: TUI-inspired, 8-bit, brutalist aesthetic. Chat-first layout with inline artifacts and live diagnostics.

**Tasks (New Direction):**
- [x] 016: TUI Brutalist Design System ✅ — AppColors, AppTypography, AppSpacing, TuiHeader/TuiCard/TuiButton/TuiModal
- [x] 017: Chat-First Main View ✅ — Column layout replacing Stack+Positioned; CompactWaveform, ChatTranscript (ListView.builder), MicButton with all states
- [x] 018: Artifact System Redesign ✅ — inline artifact buttons in chat, bottom sheet drawer, artifacts list modal, counter button
- [x] 019: Live Diagnostics Status Bar ✅ — DiagnosticsBar with health orb, SYS/VAD/RT metrics, expandable TuiModal diagnostics view
- [x] 020: Inline Connection & Room Events ✅ — SystemEvent model + SystemEventCard widget; NETWORK/ROOM/AGENT lifecycle events emitted from LiveKitService; interleaved in chat transcript by timestamp
- [x] 021: Thinking Spinner in Chat Transcript ✅ — block-character arrow `███▶` with `░▒▓█·` particle explosion; 12 unit tests passing
- [x] 023: Artifact–Message Association ✅ — artifacts render inline below their originating agent message instead of pooling together (BUG-012)
- [x] 024: Diagnostics Panel — Live Pipeline Values ✅ — removed hardcoded provider names (BUG-013); wired RT latency, SESSION, AGENT, UPTIME; DiagnosticsInfo model + pipeline_info data channel support
- [ ] 025: Fix UI State Desync — Agent Connection Status 📋 — diagnostics show `AGENT: --` despite active voice session; state update propagation + reconnection diagnostics refresh (BUG-010)
- [ ] 026: Portrait Orientation Lock 📋 — lock app to portrait mode; landscape not designed for ([BUG-011](../docs/field-tests/20260307-buglog.md))
- [ ] 027: Fix Arrow Loading Indicator Rendering 📋 — "box" artifact and missing chunky visual weight in ThinkingSpinner ([BUG-017](../docs/field-tests/20260307-buglog.md))
- [ ] 028: App Rename — Two-Word Dash Branding 📋 — rename app for field testing (e.g., "Fletcher-Orphan-Jewel") ([BUG-018](../docs/field-tests/20260307-buglog.md))
- [ ] 029: Random Two-Word-Dash Room Names 📋 — human-readable room names instead of timestamps ([BUG-019](../docs/field-tests/20260307-buglog.md))
- [ ] 030: Speech Bubble Width 📋 — agent message bubbles too narrow in Brutalist UI ([20260307 buglog](../docs/field-tests/20260307-buglog.md))
**Retained:**
- [x] 015: Single Audio Ack + Visual Spinner ✅ — Single-shot ack tone + SweepGradient spin on AmberOrb during thinking state
- [~] 014: Human-Centric Interruption Handling 🔄 — Phase 1 done; Phase 3 (soft TTS fade) needs SDK support

**Superseded:** ~~008: Collaborative Waveform~~ (absorbed into 017)

### 12. [Audio-First System Prompts](./14-system-prompts) 📋
Implementing best practices for TTS optimization, audio summaries, and visual-audio coordination.

**Tasks:**
- [ ] 016: Core TTS Rule Enforcement 📋 — strictly no markdown, phonetic spelling, punctuation for prosody
- [ ] 017: Visual-Audio Artifact Coordination 📋 — auto-push detailed artifacts for complex data; verbal anchors
- [ ] 018: Contextual Noise & Ambiguity Guard 📋 — harden agent against STT errors and hallucinations
- [ ] 019: Session Initiation & Warm Start 📋 — silent background pre-loading of memory and project context

### 13. [Speaker Isolation (Voice Lock)](./11-speaker-isolation) 🔄
Lock onto the primary speaker's voice in a 1-on-1 conversation — reject background speech, ambient noise, and echo so only the intended user is transcribed.

**Tasks (4 tiers, low→high effort):**
- [x] 001: Audit Android AudioSource selection — explicit audio config, highPassFilter enabled, speech bitrate
- [x] 002: Verify AEC is active on-device — AEC + voiceIsolation explicitly configured
- [ ] 003: Near-field energy gating
- [ ] 004: Adaptive noise floor subtraction
- [ ] 005: Speaker F0 (pitch) tracking
- [ ] 006: Research Target Speaker Extraction (TSE) models
- [ ] 007: TSE enrollment from first utterance
- [ ] 008: TSE integration into voice pipeline
- [ ] 009: Personalized noise suppression fallback
- [ ] 010: Turn-based speaker gating
- [ ] 011: Enrollment prompt design
- [ ] 012: STT confidence-based crosstalk detection

**Recommended order:** 001+002 (audit) → 010+011 (conversational gating) → 003 (energy gate) → 006→008 (TSE spike & integration)

**Depends on:** Epic 6 (voice-key embeddings reusable for TSE), Epic 10 (latency measurement)

### 13. [Edge Intelligence](./13-edge-intelligence) 📋
Move sensing capabilities (Wake Word, VAD, STT) to the edge device to improve privacy, battery life, and latency.

**Tasks:**
- [x] 001: Create Wake Word Spec ✅
- [x] 002: Wake Word Prototype (Spike) ✅ — `onnxruntime` + `mic_stream` + `hey_jarvis` model implemented (mock inference)
- [~] 003: Integrated Wake Word 🔄 — Wired into Amber Orb state machine; debug trigger added
- [ ] 004: Local VAD Evaluation 📋 — Benchmark Silero VAD on-device vs server-side
- [ ] 005: Offline Mode 📋 — Cache interactions when offline

**Spec:** [docs/specs/wake-word-integration.md](../docs/specs/wake-word-integration.md)

### 15. [Macro Shortcuts](./15-macro-shortcuts) 📋
Customizable quick-action buttons for triggering skill-driven commands without voice input. 3×3 grid optimized for thumb-zone ergonomics.

**Tasks:**
- [ ] 022: Macro Shortcut System 📋 — model, registry, TuiMacroCluster widget, action dispatcher, initial 9-macro dev set

## Development Path

1. **Phase 1: Infrastructure** ✅
   - Set up monorepo with pnpm workspaces
   - Create plugin package structure
   - Set up LiveKit server (local or cloud)

2. **Phase 2: Voice Agent Pipeline** 🔄
   - Build STT → OpenClaw → TTS pipeline
   - Achieve <1.5s latency target

3. **Phase 3: Flutter App** ✅
   - Create mobile app with LiveKit client
   - Implement Amber Heartbeat visualizer
   - One-button interface to join room

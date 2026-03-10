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
- [x] 009: TTS Empty Chunk Guard ✅ — provider-agnostic guard buffers leading punctuation/whitespace-only chunks before TTS; applied at `ttsNode()` via `GuardedAgent`; 18 unit tests ([BUG-005](../docs/field-tests/20260301-buglog.md))
- [ ] 010: Fix Agent Dispatch in `dev` Mode 📋 — worker registers but LiveKit never dispatches jobs; `connect --room` workaround ([BUG-007](../docs/field-tests/20260301-buglog.md))
- [ ] 011: Voice Selection Persistent Preferences 📋 — selection UI/API with persistent storage and env-var based config
- [ ] 020: Agent Dual-Channel Transcript Emission 📋 — emit `TranscriptEvent` on `ganglia-events` data channel (reliable); fixes BUG-030 (Unidirectional Blackout)
- [~] 012: Agent Self-Terminate on Session Error 🔄 — Priority: prevent zombie agents; disconnect from room when session dies
- [ ] 013: Voice-Aware Metadata Tagging 📋 — inject `is_stt: true` into metadata sent to OpenClaw to enable higher verification thresholds for noisy inputs
- [x] 015: Tiered Edge TTS Prototype ✅ — PiperTTS plugin + FallbackAdapter wired; Piper sidecar in docker-compose; UX feedback artifacts (Voice Degraded/Restored/Unavailable)
- [ ] 016: Buffer Catch-Up Optimization 📋 — Research accelerated PCM playout and transcript-only catch-up to sync conversation after blackouts
- [ ] 017: Voice Agent Memory Leak (RCA) 📋 — root-cause analysis for 7.4 GB leak; see 018 and 019 for implementation ([BUG-004](../docs/field-tests/20260305-buglog.md))
- [ ] 018: Upstream `_AudioOut.audio` Memory Leak 📋 — file issue + PR on `livekit/agents-js`: `out.audio.push(frame)` in `generation.ts` accumulates all TTS frames, never cleared
- [~] 019: Internal Memory Leak Mitigations 🔄 — `knownStreamIds` cleanup, OTel span leak patch, Docker 4G limit, heap snapshot mechanism; pending field verification
- [~] 014: Human-Centric Interruption Handling 🔄 — Phase 1 complete: fixed endpointing delay units bug (0.8→800ms), increased `minInterruptionDuration` to 800ms, added `minInterruptionWords: 1` to reduce false interruptions; Phase 2-3 (ack sound edge cases, soft TTS fade) deferred pending field testing
- [x] 014: TTS Error Graceful Degradation ✅ — `maxUnrecoverableErrors: Infinity` prevents session death; `ttsConnOptions: { maxRetry: 0 }` eliminates 429 retry storms; debounced "Voice Unavailable" artifact sent to client ([BUG-024](../docs/field-tests/20260304-buglog.md))
- [ ] 032: Idle Timer TTS-Aware 📋 — reset idle timer on `speaking → listening` so TTS playout doesn't consume the idle window; 100% repro in storytelling mode ([BUG-002](../docs/field-tests/20260310-buglog.md))
- [ ] 033: Bootstrap TTS Settle Window 📋 — 200ms delay before bootstrap `generateReply()` + unconditional `_sendTtsMode()` on agent connect; prevents wake-up TTS race where `audioOutput` snapshot precedes client re-sync ([BUG-001](../docs/field-tests/20260310-buglog.md))

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
- [ ] 005: SQLite Local Persistence for Chat Transcript 📋 — messages/artifacts cleared on app restart; need local SQLite storage ([BUG-016](../docs/field-tests/20260307-buglog.md))
- [ ] 021: Data Channel Transcript Listener 📋 — receive `TranscriptEvent` from `ganglia-events`; update ConversationBloc; source of truth for persistent log (BUG-030)
- [ ] 022: Persistent Conversation View 📋 — scrollable chat log UI bound to ConversationBloc; interim/final rendering; auto-scroll; replaces ephemeral subtitles (BUG-030)

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
- [x] 005: End-to-End OpenClaw Integration ✅ — validated full voice pipeline against real Gateway across multiple field test sessions; session continuity and guest isolation confirmed
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
- [x] 001: Enable preemptive generation & tune endpointing ✅ — `preemptiveGeneration: true`, endpointing delays tuned via BUG-014/TASK-014
- [ ] 003: Streaming interim transcripts to LLM (Phase 2)
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

### 7. [Sovereign Pairing](./07-sovereign-pairing) 📋
Secure, zero-config onboarding: scan a QR code to pair Fletcher with a self-hosted Hub.

**Tasks:**
- [x] 001: Create Protocol Specification ✅
- [x] 002: Implement Token Endpoint (`/fletcher/token`) ✅
- [x] 003: Integrate with LiveKit Channel Plugin ✅
- [ ] 011: OpenClaw Plugin Scaffold + Vessel Key Generation 📋 — `openclaw-plugin-fletcher` package; `vessel-key generate` CLI; QR rendering; 15-min pairing tokens
- [ ] 010: Device Registration Endpoint 📋 — `POST /fletcher/devices/register` via plugin route; pairing token validation; single-use revocation
- [ ] 012: Room Join Endpoint 📋 — `POST /fletcher/rooms/join` via plugin route; Ed25519 signature verification; LiveKit token generation
- [ ] 008: QR Code Scanner for Vessel Key Pairing 📋 — blank slate detection, `mobile_scanner` QR scanning, Vessel Key JSON parsing/validation
- [ ] 009: Ed25519 Keypair Generation & Device Registration 📋 — generate keypair, POST to Hub plugin endpoint, store credentials in FlutterSecureStorage
- [ ] 013: Mobile Managed Connection 📋 — `HubAuthService` with Ed25519 auth; TCP-race URL resolution (Epic 9); replaces `bun run token:generate`

**Specs:** [sovereign-pairing.md](../docs/specs/07-sovereign-pairing.md) | [vessel-key-pairing-spec.md](../docs/specs/vessel-key-pairing-spec.md) | [phase-1-mvp-spec.md](../docs/specs/phase-1-mvp-spec.md)

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
- [x] 008: Tailscale-aware URL resolution ✅ — TCP race between LAN and Tailscale URLs; whichever connects first wins (replaced broken VPN detection)
- [x] 009: Bluetooth audio route recovery — `restartTrack()` swaps audio source without unpublishing ✅ ([BUG-004](../docs/field-tests/20260301-buglog.md))
- [ ] 010: Diagnostics Stale After Reconnect 📋 — HealthService doesn't re-enumerate participants after DUPLICATE_IDENTITY reconnect ([BUG-016](../docs/field-tests/20260302-buglog.md))
- [ ] 011: Network Transition Audio Track Timeout 📋 — WiFi→cellular causes 55s audio track publish delay (Tailscale tunnel re-establishment) + BT audio route disruption ([BUG-021](../docs/field-tests/20260303-buglog.md))
- [ ] 012: Foreground Service for Background Microphone 📋 — Android 14+ silences mic within 5s of backgrounding; add `FOREGROUND_SERVICE_MICROPHONE` to keep voice session alive in pocket ([BUG-022](../docs/field-tests/20260303-buglog.md))
- [~] 013: Client-Side Audio Buffering 🔄 — covers two scenarios: (A) network dead zones via SDK `PreConnectAudioBuffer` (client-side done), (B) agent dispatch latency — first seconds of speech lost while agent connects after on-demand dispatch (not started). Agent-side handler for `lk.agent.pre-connect-audio-buffer` topic not yet verified for either. See [013-audio-buffering-plan.md](./09-connectivity/013-audio-buffering-plan.md).
- [x] 017: Time-Budgeted Reconnect ✅ — extend client retry window from ~71s to match server departure_timeout (130s); two-phase strategy: 5 fast retries + slow 10s poll until budget expires; budget clock starts on first SDK reconnect attempt; verified via e2e test 008 ([BUG-028](../docs/field-tests/20260304-buglog.md))
- [~] 018: Fix URL Resolver VPN Detection 🔄 — TCP race between LAN and Tailscale URLs (Option A); replaces broken "always use Tailscale" approach; needs field test ([BUG-031](../docs/field-tests/20260304-buglog.md), [BUG-004](../docs/field-tests/20260306-buglog.md))
- [~] 019: Background Session Timeout & App-Close Disconnect 🔄 — implemented: `stopWithTask="true"` for swipe-away disconnect, screen lock detection via method channel, 10-min background timeout with notification countdown; pending field verification
- [ ] 020: Agent Reconnect After Worker Restart 📋 — LiveKit doesn't re-dispatch agent jobs after worker restart; orphaned rooms with users but no agent ([BUG-005](../docs/field-tests/20260306-buglog.md))
- [x] 021: Dynamic Room Names ✅ — dynamic `fletcher-<timestamp>` room names with token endpoint; client creates new room on budget exhaustion for seamless agent restart recovery; e2e tests 006-008 passing ([BUG-005](../docs/field-tests/20260306-buglog.md)) — **closed**
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
- [x] 026: Portrait Orientation Lock ✅ — `SystemChrome.setPreferredOrientations` in main.dart
- [ ] 027: Fix Arrow Loading Indicator Rendering 📋 — "box" artifact and missing chunky visual weight in ThinkingSpinner ([BUG-017](../docs/field-tests/20260307-buglog.md))
- [ ] 029: Random Two-Word-Dash Room Names 📋 — human-readable room names instead of timestamps ([BUG-019](../docs/field-tests/20260307-buglog.md))
- [x] 030: Text-Only Response Mode ✅ — `[TTS: ON/OFF]` toggle via data channel; agent skips TTS natively via `setAudioEnabled()`; persisted across restarts
- [x] 030: Split Header into Two-Column Layout ✅ — cyan user histogram (left) + TTS toggle (right); HeaderBar widget
- [x] 031/032: TTS Toggle Component + Agent Wiring ✅ — "TTS OFF" button ↔ amber agent histogram; single-tap toggle; `tts-mode` data channel event; persisted via SessionStorage
- [ ] 033: SpeakingRing Component 📋 — animated ring around participant avatars; VAD-driven; amber (user) / blue (agent)
- [ ] 034: Inline Participant Histogram 📋 — compact AudioVisualizer in each participant row; 30fps throttle for 3+ participants
- [ ] 035: Per-Participant Audio Stream Wiring 📋 — AnalyserNode per participant; connect to SpeakingRing + inline histogram
- [ ] 036: TUI Theme Bundles (Solarized, Gruvbox, Nord) 📋 — implementation of classic terminal-inspired color palettes
- [ ] 037: Deduplicate Agent System Events & Expandable Long Rows 📋 — remove duplicate Connected/Disconnected cards; fix "speak or text" copy; tap-to-expand long system event rows
- [x] 038: Fix Artifact Clump Regression After Agent Reconnect ✅ — `_lastAgentSegmentId` reset on disconnect; artifacts now correctly distributed across messages ([BUG-004](../docs/field-tests/20260310-buglog.md))
**Retained:**
- [x] 015: Single Audio Ack + Visual Spinner ✅ — Single-shot ack tone + SweepGradient spin on AmberOrb during thinking state
- [~] 014: Human-Centric Interruption Handling 🔄 — Phase 1 done; Phase 3 (soft TTS fade) needs SDK support

**Superseded:** ~~008: Collaborative Waveform~~ (absorbed into 017)

### 12. [Audio-First System Prompts](./14-system-prompts) 📋
Implementing best practices for TTS optimization, audio summaries, and visual-audio coordination.

**Tasks:**
- [x] 016: Core TTS Rule Enforcement ✅ — strictly no markdown, phonetic spelling, punctuation for prosody; bootstrap message updated in `apps/voice-agent/src/bootstrap.ts`; 12 tests added
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
- [x] 031: Local PiperTTS on Android → **MIGRATED to Epic 19** ✅

**Spec:** [docs/specs/wake-word-integration.md](../docs/specs/wake-word-integration.md)

**Note:** Task 031 (Local PiperTTS) has been promoted to its own epic (Epic 19: Local Piper TTS Integration) due to its strategic importance for COGS reduction and offline operation.

### 15. [Macro Shortcuts](./15-macro-shortcuts) 📋
Customizable quick-action buttons for triggering skill-driven commands without voice input. 3×3 grid optimized for thumb-zone ergonomics.

**Tasks:**
- [ ] 022: Macro Shortcut System 📋 — model, registry, TuiMacroCluster widget, action dispatcher, initial 9-macro dev set

### 16. [LiveKit Flutter SDK Issues](./livekit-flutter-sdk) 📋
Upstream bugs and limitations in the `livekit_client` Flutter/Dart SDK that affect Fletcher's mobile client.

**Tasks:**
- [ ] 004: Fix `addTransceiver: track is null` During Reconnect 📋 — null track reference during `rePublishAllTracks` after rapid reconnect cycles ([BUG-025](../docs/field-tests/20260303-buglog.md))
- [ ] 005: Release Android AudioManager Mode on Mute 📋 — `MODE_IN_COMMUNICATION` blocks keyboard STT after muting; toggle via `flutter_webrtc` API ([BUG-001](../docs/field-tests/20260309-buglog.md))

**Related closed tasks** (resolved with workarounds in Epic 9): 007 (ICE renegotiation), 009 (BT audio recovery), 011 (audio track timeout).

### 17. [Text Input Mode](./17-text-input) ✅
Text entry "safety hatch" for when voice isn't ideal. Tap mic to mute and reveal text field; tap again to unmute and hide. Enter key submits. Messages route via LiveKit data channel to the same conversation context as voice.

**All 17 tasks complete.** See [EPIC.md](./17-text-input/EPIC.md) for details.

### 18. [OpenResponses API Integration](./18-openresponses-api) 🔄
Refactor the Fletcher voice agent to use the native OpenClaw **OpenResponses API** (`/v1/responses`) instead of the OpenAI-compatible **Chat Completions API** (`/v1/chat/completions`) for more reliable delivery and better session management.

**Tasks:**
- [x] 001: Research OpenResponses API spec ✅
- [x] 002: Add `respond()` method to OpenClawClient ✅
- [x] 003: Implement OpenResponses SSE parser ✅
- [x] 004: Map OpenResponses events to LLMStream interface ✅
- [x] 005: Update voice agent to use `respond()` instead of `chat()` ✅
- [x] 006: Enhanced error handling for OpenResponses error items ✅
- [~] 007: Integration test with real OpenClaw Gateway 🔄 — unit tests (22 new) passing; integration pending Gateway
- [ ] 008: Deprecation plan for Chat Completions endpoint 📋

**Implemented:**
- `OpenClawClient.respond()` targets `/v1/responses` with full SSE parsing
- `OpenClawClient.respondAsChat()` maps events to ChatResponse format (backward compatible)
- `OpenClawLLM` uses `respondAsChat()` when `useOpenResponses: true` or `USE_OPENRESPONSES=true`
- `convertMessagesToInput()` bridges Chat Completions messages to InputItem format
- Error classes: `OpenResponsesError`, `RateLimitError` with Retry-After support
- 22 new unit tests covering all methods, event types, errors, and routing

**Depends on:** Epic 4 (Ganglia), OpenClaw Gateway OpenResponses endpoint

### 19. [Local Piper TTS Integration](./19-local-piper-tts) 🔄
Move the Piper TTS engine from the server sidecar to the mobile client (Android/iOS) for on-device voice synthesis. Eliminate cloud voice-out costs (drop COGS to $0), enable offline operation, and achieve zero-network-hop voice latency.

**Tasks:**
- [x] 001: Local PiperTTS Discovery & Feasibility ✅ — sherpa-onnx v1.12.28 confirmed as integration path; model is 63MB (not 18MB); NNAPI crashes for TTS; download-on-first-use recommended; ~500MB peak RAM is key risk
- [ ] 002: Sherpa-ONNX Flutter Integration 📋 — ready for prototyping; API validated, code examples documented
- [~] 003: Model Selection & Bundling Strategy 🔄 — research complete (en_US-lessac-medium, download-on-first-use); benchmarking and INT8 quantization pending
- [ ] 004: Local TTS Pipeline & Fallback Integration 📋 — server-side artifacts already exist (tts-fallback-monitor.ts); audio playback conflict needs design
- [ ] 005: Performance Optimization & Battery Impact 📋 — NNAPI not viable; CPU-only; memory is primary risk
- [ ] 006: Offline Mode & Edge TTS Coordination 📋 — ConnectivityService already exists; model must be pre-downloaded for offline

**Context:** This is the key to reaching a 50% margin for the Fletcher Pro tier by removing the ~$0.135/min cloud TTS overhead. Discovery phase complete (2026-03-08).

**Depends on:** Epic 3 (Flutter App), Epic 13 (Edge Intelligence)

### 20. [Agent Cost Optimization](./20-agent-cost-optimization) 🔄
Eliminate idle agent costs by disconnecting the agent when nobody is speaking and re-dispatching on demand via client-side VAD. At multi-tenant scale, idle agents are the dominant cost driver ($0.01/min per connected agent regardless of activity). On-demand dispatch reduces idle costs by ~20x (from $0.60/hr to $0.03/hr per idle user).

**Tasks:**
- [x] 001: Switch Agent to Explicit Dispatch ✅ — `agentName: 'fletcher-voice'` set on ServerOptions; `RoomAgentDispatch` added to token server; 12 unit tests
- [x] 002: Add Dispatch Endpoint to Token Server ✅ — `POST /dispatch-agent` calls `AgentDispatchClient.createDispatch()`; `wsUrlToHttp` helper; 21 total tests
- [x] 003: Client-Side VAD Integration (Flutter) ✅ — `LocalVadService` + `AgentDispatchService` with 11 unit tests; `vad` and `http` packages added
- [x] 004: Agent Idle Timeout & Auto-Disconnect ✅ — `IdleTimeout` class with configurable timer, warning + warm-down callbacks; 20 unit tests
- [x] 005: Client State Machine (Agent Presence Lifecycle) ✅ — `AgentPresenceService` 4-state machine; wires LocalVadService + AgentDispatchService; 29 unit tests
- [x] 006: Cold-Start Latency Mitigation ✅ — `prewarm` (VAD pre-load), warm-down grace period (`FLETCHER_WARM_DOWN_MS`), dispatch latency metric
- [x] 007: UX Polish — Transition Feedback ✅ — system event emission on state transitions; data channel callbacks in LiveKitService; 9 new tests
- [ ] 008: Integration Test & Cost Validation 📋 — e2e lifecycle test + LiveKit Cloud billing verification (requires running infrastructure)
- [x] 009: Suppress Reconnecting Banner on Intentional Agent Disconnect ✅ — guard `TrackUnsubscribedEvent` with `AgentPresenceState`; banner suppressed during idle timeout lifecycle
- [x] 010: Unmute as Agent Dispatch Trigger ✅ — unmuting while agent absent calls `onSpeechDetected()`; ~300-500ms head start before audio-level detection

**Depends on:** Epic 2 (Voice Agent), Epic 3 (Flutter App), Epic 9 (Connectivity)

### 21. [Photo Upload & Vision Support](./21-photo-upload-vision) 🔄
Multi-modal input: upload photos and make them available to OpenClaw for vision reasoning.

**Tasks:**
- [ ] 001: Image Selection & Capture UI (Flutter)
- [ ] 002: Direct Image Upload API in Gateway Integration
- [ ] 003: Inline Image Previews in TUI Transcript
- [ ] 004: Multi-Modal Session Context Support
- [ ] 005: Voice-to-Vision Orchestration

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

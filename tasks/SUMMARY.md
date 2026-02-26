# Fletcher Project Roadmap

Fletcher is a high-performance voice-first bridge for OpenClaw using LiveKit, built as an OpenClaw channel plugin.

## Architecture

Fletcher is an **OpenClaw Channel Plugin** that integrates LiveKit voice capabilities directly into OpenClaw, similar to Telegram and WhatsApp channels. This provides:
- Deep integration with OpenClaw core
- Automatic conversation management
- Single deployment with OpenClaw Gateway
- Access to all OpenClaw skills, tools, and memory

See [Architecture Comparison](../docs/architecture-comparison.md) for detailed analysis.

## Epics

### 1. [Infrastructure](./01-infrastructure) ✅
Setting up the development environment, LiveKit server, and monorepo structure.

**Tasks:**
- [x] 001: Setup LiveKit server (local or cloud)
- [x] 002: Repository structure & CI/CD
- [x] 003: Bootstrap script (cross-platform)

### 2. [OpenClaw Channel Plugin](./02-livekit-agent) 🔄
The LiveKit channel plugin (`@openclaw/channel-livekit`) that integrates voice capabilities into OpenClaw.

**Tasks:**
- [~] 001: Initialize OpenClaw channel plugin — plugin structure and OpenClaw integration done; testing remaining
- [~] 002: Implement audio pipeline (STT/TTS) — wired to SDK + Ganglia; actual provider integration, audio track management, latency monitoring remaining
- [ ] 003: Debug voice agent not responding (blocked by flutter-app/003)
- [x] 004: Channel plugin approach (implementation guide)
- [x] 005: Token generation endpoint (Sovereign Pairing) ✅

**Implemented:**
- Full plugin structure with OpenClaw adapters (config, security, gateway, outbound, status)
- VoiceAgent wired to `@livekit/agents` SDK (deepgram.STT, cartesia.TTS, voice.AgentSession)
- Ganglia LLM as brain via `@knittt/livekit-agent-ganglia`
- Multi-account support with environment variable fallback
- STT/TTS provider interfaces and factory functions
- OpenClaw core integration (handleMessage, outbound.sendText, state machine)
- **Token Endpoint:** `/fletcher/token` with Ed25519 signature verification (Sovereign Pairing)

**Remaining:**
- Unit/integration tests for channel plugin (mock providers, hello-world test)
- Full audio track subscription and chunk publishing
- Latency monitoring and metrics

### 3. [Flutter App](./03-flutter-app) 🔄
The mobile client for real-time voice interaction and visualization.

**Tasks:**
- [x] 001: Initialize Flutter app ✅
- [x] 002: Implement Amber Heartbeat visualizer ✅
- [ ] 003: Voice activity indicator & real-time STT display

**Implemented:**
- Full Flutter app with livekit_client integration
- AmberOrb visualizer with all conversation states
- Real-time audio level monitoring (50ms polling)
- Mute toggle, auto-connect, dark theme
- Ganglia data channel subscription (`ganglia-events` topic)
- StatusBar widget showing agent actions (reading, searching, editing)
- ArtifactViewer for diffs, code blocks (with Markdown support), search results, errors

### 4. [Standalone Brain Plugin](./04-livekit-agent-plugin) 🔄
A unified LLM plugin (`@knittt/livekit-agent-ganglia`) that bridges LiveKit agents to OpenClaw or Nanoclaw via OpenAI-compatible API.

**Tasks:**
- [~] 001: Standalone Brain Plugin — OpenClaw working, unit tests passing; advanced features (async tools, context injection) and documentation remaining
- [~] 002: Nanoclaw Integration — Phase 1-3 complete, Phase 4 (integration tests) in progress

**Implemented:**
- Unified `@knittt/livekit-agent-ganglia` package with types, factory, events, tool-interceptor
- `OpenClawLLM` implementation with auth, sessions, message mapping
- `NanoclawLLM` implementation with JID-based channel headers
- Backend switching via `GANGLIA_TYPE` env var (openclaw | nanoclaw)
- `/add-openai-api` skill documented for Nanoclaw (needs to be applied)
- `ToolInterceptor` for visual feedback (status events, artifacts)
- Flutter UI: `StatusBar` widget and `ArtifactViewer` (diff, code, search results)
- Data channel subscription for `ganglia-events` topic
- 129 unit tests passing

**Remaining:**
1. Apply `/add-openai-api` skill to Nanoclaw repo
2. Integration tests with both backends (end-to-end voice conversation)
3. Error handling and retry tests (network failures, rate limits)
4. Async tool resolution support
5. Context injection (LiveKit room metadata → OpenClaw context)
6. Package README and documentation
7. CI/CD for npm publishing
8. Syntax highlighting for code artifacts (optional)

### 5. [Latency Optimization](./05-latency-optimization) 📋
Pipeline optimizations to reduce voice-to-voice latency from ~1.4s to <0.8s.

**Tasks:**
- [ ] 001: Enable preemptive generation & tune endpointing (Phase 1)
- [ ] 002: Add latency instrumentation & metrics (Phase 1b)
- [ ] 003: Streaming interim transcripts to LLM (Phase 2)
- [ ] 004: TTS pre-warming validation (Phase 3)

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

### 7. [Sovereign Pairing](./07-sovereign-pairing) ✅
Signature-based authentication protocol (Ed25519) for edge devices.

**Tasks:**
- [x] 001: Create Protocol Specification
- [x] 002: Implement Token Endpoint (`/fletcher/token`)
- [x] 003: Integrate with LiveKit Channel Plugin

**Spec:** [docs/specs/07-sovereign-pairing.md](../docs/specs/07-sovereign-pairing.md)

## Development Path

1. **Phase 1: Infrastructure** ✅
   - Set up monorepo with pnpm workspaces
   - Create plugin package structure
   - Set up LiveKit server (local or cloud)

2. **Phase 2: Channel Plugin** 🔄
   - Implement OpenClaw channel plugin interface
   - Integrate LiveKit connection
   - Build STT → OpenClaw → TTS pipeline
   - Achieve <1.5s latency target

3. **Phase 3: Flutter App** ✅
   - Create mobile app with LiveKit client
   - Implement Amber Heartbeat visualizer
   - One-button interface to join room

4. **Phase 4: Publishing**
   - Publish plugin to npm as `@openclaw/channel-livekit`
   - Open source under MIT license
   - Submit to OpenClaw plugin directory

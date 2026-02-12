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

### 2. [OpenClaw Channel Plugin](./02-livekit-agent) 🔄
The LiveKit channel plugin (`@openclaw/channel-livekit`) that integrates voice capabilities into OpenClaw.

**Tasks:**
- [x] 001: Initialize OpenClaw channel plugin ✅
- [~] 002: Implement audio pipeline (STT/TTS) - structure done, provider integration TODO
- [x] 004: Channel plugin approach (implementation guide)

**Implemented:**
- Full plugin structure with OpenClaw adapters (config, security, gateway, outbound, status)
- VoiceAgent with state machine (idle/listening/thinking/speaking)
- STT/TTS provider interfaces with Deepgram/Cartesia/ElevenLabs config
- Multi-account support with environment variable fallback

**Remaining:**
- Actual Deepgram WebSocket integration (placeholder exists)
- Actual Cartesia/ElevenLabs API integration (placeholder exists)
- Audio track publishing to LiveKit room
- End-to-end latency validation

### 3. [Flutter App](./03-flutter-app) ✅
The mobile client for real-time voice interaction and visualization.

**Tasks:**
- [x] 001: Initialize Flutter app ✅
- [x] 002: Implement Amber Heartbeat visualizer ✅

**Implemented:**
- Full Flutter app with livekit_client integration
- AmberOrb visualizer with all conversation states
- Real-time audio level monitoring (50ms polling)
- Mute toggle, auto-connect, dark theme

### 4. [Standalone Brain Plugin](./04-livekit-agent-plugin) 🔄
A unified LLM plugin (`@knittt/livekit-agent-ganglia`) that bridges LiveKit agents to OpenClaw or Nanoclaw via OpenAI-compatible API.

**Tasks:**
- [x] 001: Standalone Brain Plugin ✅ (OpenClaw working)
- [~] 002: Nanoclaw Integration (Phase 1-2 complete, Phase 3-4 in progress)

**What's Done:**
- Unified `@knittt/livekit-agent-ganglia` package with types, factory, events, tool-interceptor
- `OpenClawLLM` implementation with auth, sessions, message mapping
- `/add-openai-api` skill documented for Nanoclaw (needs to be applied)
- `ToolInterceptor` for visual feedback (status events, artifacts)
- 86 unit tests passing

**Next Steps:**
1. Apply `/add-openai-api` skill to Nanoclaw repo
2. Add `NanoclawLLM` class with header handling
3. Wire ToolInterceptor to LiveKit data channel
4. Flutter UI for status bar and artifact viewer

## Development Path

1. **Phase 1: Infrastructure**
   - Set up monorepo with pnpm workspaces
   - Create plugin package structure
   - Set up LiveKit server (local or cloud)

2. **Phase 2: Channel Plugin**
   - Implement OpenClaw channel plugin interface
   - Integrate LiveKit connection
   - Build STT → OpenClaw → TTS pipeline
   - Achieve <1.5s latency target

3. **Phase 3: Flutter App**
   - Create mobile app with LiveKit client
   - Implement Amber Heartbeat visualizer
   - One-button interface to join room

4. **Phase 4: Publishing**
   - Publish plugin to npm as `@openclaw/channel-livekit`
   - Open source under MIT license
   - Submit to OpenClaw plugin directory

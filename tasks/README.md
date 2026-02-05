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

### 1. [Infrastructure](./01-infrastructure)
Setting up the development environment, LiveKit server, and monorepo structure.

**Tasks:**
- 001: Setup LiveKit server (local or cloud)
- 002: Repository structure & CI/CD

### 2. [OpenClaw Channel Plugin](./02-livekit-agent)
The LiveKit channel plugin (`@openclaw/channel-livekit`) that integrates voice capabilities into OpenClaw.

**Tasks:**
- 001: Initialize OpenClaw channel plugin
- 002: Implement audio pipeline (STT/TTS)
- 004: Channel plugin approach (implementation guide)

### 3. [Flutter App](./03-flutter-app)
The mobile client for real-time voice interaction and visualization.

**Tasks:**
- 001: Initialize Flutter app
- 002: Implement Amber Heartbeat visualizer

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

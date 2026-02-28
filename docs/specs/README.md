# Fletcher Technical Specifications

Technical design documents for Fletcher components. For implementation progress, see [`tasks/`](../../tasks/).

## Structure

```
specs/
├── 01-infrastructure/          # LiveKit server, monorepo setup
│   └── spec.md
├── 02-livekit-agent/           # Channel Plugin (@knittt/openclaw-channel-livekit)
│   ├── spec.md                 # Main technical spec
│   └── testing-strategy.md     # Testing approach without OpenClaw
├── 03-flutter-app/             # Mobile App (apps/mobile)
│   └── ux.md                   # UI/UX specification
├── 04-livekit-agent-plugin/    # Brain Plugin (@knittt/livekit-agent-ganglia)
│   ├── spec.md                 # Main technical spec
│   └── tool-calling.md         # Tool/skill calling feature
├── 05-latency-optimization/    # Voice pipeline latency optimization
│   └── spec.md                 # Overlapped STT/LLM, preemptive generation
├── 08-session-continuity/      # Session persistence across room reconnections
│   ├── spec.md                 # Backend-agnostic session routing architecture
│   ├── openclaw-implementation.md
│   └── nanoclaw-implementation.md
└── architecture-comparison.md  # Cross-cutting architecture decisions
```

## Quick Links

### Infrastructure
- [Spec](./01-infrastructure/spec.md) - LiveKit server, Bun workspace, monorepo structure

### Channel Plugin (`packages/openclaw-channel-livekit`)
- [Main Spec](./02-livekit-agent/spec.md) - OpenClaw channel plugin for LiveKit voice
- [Testing Strategy](./02-livekit-agent/testing-strategy.md) - Testing without OpenClaw

### Mobile App (`apps/mobile`)
- [UX Spec](./03-flutter-app/ux.md) - Amber orb visualizer, voice-first design

### Brain Plugin (`packages/livekit-agent-ganglia`)
- [Main Spec](./04-livekit-agent-plugin/spec.md) - LiveKit Agents LLM plugin for OpenClaw/Nanoclaw
- [Tool Calling](./04-livekit-agent-plugin/tool-calling.md) - Voice-enabled skill/tool execution
- [Nanoclaw Integration](./04-livekit-agent-plugin/nanoclaw-integration.md) - Pluggable brain architecture

### Latency Optimization
- [Main Spec](./05-latency-optimization/spec.md) - Overlapped STT/LLM pipeline, preemptive generation, endpointing tuning

### Session Continuity
- [Main Spec](./08-session-continuity/spec.md) - Backend-agnostic session routing: rooms are transport, sessions persist
- [OpenClaw Implementation](./08-session-continuity/openclaw-implementation.md) - Owner→main, guest→user field, room→user field
- [Nanoclaw Implementation](./08-session-continuity/nanoclaw-implementation.md) - Single-user simplification, channel headers

### Cross-Cutting
- [Architecture Comparison](./architecture-comparison.md) - Three integration approaches compared

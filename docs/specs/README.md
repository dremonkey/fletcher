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
├── 04-livekit-agent-plugin/    # Brain Plugin (@knittt/livekit-agent-openclaw)
│   ├── spec.md                 # Main technical spec
│   └── tool-calling.md         # Tool/skill calling feature
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

### Brain Plugin (`packages/livekit-agent-openclaw`)
- [Main Spec](./04-livekit-agent-plugin/spec.md) - LiveKit Agents LLM plugin for OpenClaw
- [Tool Calling](./04-livekit-agent-plugin/tool-calling.md) - Voice-enabled skill/tool execution

### Cross-Cutting
- [Architecture Comparison](./architecture-comparison.md) - Three integration approaches compared

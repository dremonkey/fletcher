# Fletcher

A mobile [ACP](https://github.com/anthropics/acp) (Agent Communication Protocol) client with voice and text support. Point it at any ACP-compatible agent — OpenClaw, Claude Code, or your own — and get a full mobile frontend with voice conversations, text chat, tool-call visibility, artifact rendering, and session management. The agent is a config flag (`ACP_COMMAND`); the client handles everything else.

## Repository Map

```
fletcher/
├── apps/
│   ├── relay/                      # ACP bridge (the core) — data channel ↔ ACP subprocess over stdio
│   ├── mobile/                     # Flutter mobile client — voice + text, artifacts, reconnection
│   └── voice-agent/                # Optional voice runtime — STT → LLM → TTS via LiveKit
├── packages/
│   ├── livekit-agent-ganglia/      # LLM bridge plugin — connects voice pipeline to ACP via relay
│   └── tui/                        # Developer TUI launcher
├── docs/
│   ├── architecture/               # Canonical technical docs (start here for depth)
│   └── specs/                      # Planning artifacts (may be outdated)
├── tasks/                          # Project roadmap and progress tracking
├── docker-compose.yml              # LiveKit + voice-agent + token-server + Piper TTS
├── livekit.yaml                    # LiveKit server config
├── flake.nix                       # Nix development environment
└── package.json                    # Bun workspace root
```

## Components

| Component | Path | Role |
|-----------|------|------|
| **Relay** | `apps/relay` | Transparent JSON-RPC 2.0 bridge: mobile data channel ↔ ACP subprocess over stdio. The foundation — text mode works with just this and the mobile app. |
| **Mobile App** | `apps/mobile` | Flutter client with dual-mode input (voice + text), inline tool-call cards, thinking blocks, artifact viewer, and connection resilience. |
| **Voice Agent** | `apps/voice-agent` | Optional. Joins LiveKit rooms on demand, adds real-time speech: Deepgram STT → LLM → TTS, targeting sub-1.5s latency. |
| **Ganglia** | `packages/livekit-agent-ganglia` | LLM bridge plugin for the voice pipeline. Routes through the relay by default. |

## Documentation

For technical depth, start with [`docs/architecture/`](./docs/architecture/README.md) — the canonical reference for how the system works. The [reading order table](./docs/architecture/README.md#reading-order) covers the full stack from system overview through deployment.

For project status and next steps, see [`tasks/`](./tasks/README.md).

## Quick Start

```bash
nix develop        # Provides Bun, Flutter, Android SDK — all dependencies
bun dev            # TUI launcher: audits env, starts LiveKit, generates tokens, launches agent
```

Without Nix, install [Bun](https://bun.sh) manually. See [`docs/architecture/developer-workflow.md`](./docs/architecture/developer-workflow.md) for the full manual workflow.

## Encrypted Files

Field-test raw logs (`docs/field-tests/*.txt`) are encrypted with [git-crypt](https://github.com/AGWA/git-crypt) because they may contain PII. The curated bug logs (`docs/field-tests/*-buglog.md`) are plaintext and readable without unlocking.

```bash
git-crypt unlock ./git-crypt-key   # Obtain the key from a project maintainer
```

## License

MIT

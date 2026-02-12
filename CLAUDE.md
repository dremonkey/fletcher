# Fletcher Project - Static's Guide (⚡)

This project (Fletcher) is an OpenClaw channel plugin for real-time voice conversations via LiveKit.

## Core Directives
- **Runtime:** This is a **Bun** project. Prefer native Bun tools over external ones (e.g., use `bun test` instead of Vitest/Jest).
- **Architecture:** Fletcher follows the OpenClaw Channel Plugin model. The voice system lives directly inside the OpenClaw Gateway.
- **Latency Target:** Aim for sub-1.5s voice-to-voice latency.

## Project Structure
- `packages/openclaw-channel-livekit`: The primary OpenClaw channel plugin.
- `packages/livekit-agent-ganglia`: The unified Brain Plugin (bridges LiveKit to OpenClaw/Nanoclaw).
- `apps/mobile`: Example Flutter app for testing.

## Documentation & Specs
- Technical specs and integration documents belong in `docs/specs/`.
- Specs are organized by component (mirroring `tasks/` structure): `01-infrastructure/`, `02-livekit-agent/`, `03-flutter-app/`, `04-livekit-agent-plugin/`.
- Do NOT leave spec files in the project root. Move them to the appropriate `docs/specs/` subdirectory.

## Testing Standards
- Use `bun:test` for all TypeScript/JavaScript unit tests.
- **Co-location Rule:** Unit tests MUST live directly alongside their corresponding source files (e.g., `src/client.ts` and `src/client.spec.ts`). Do NOT use a separate `__tests__/` directory.
- Test files should use `.spec.ts` or `.test.ts` extensions.

## Brain Bridge (`livekit-agent-ganglia`)
- This package implements `GangliaLLM` (extending `livekit.agents.llm.LLM`).
- Supports multiple backends: OpenClaw (multi-user) and Nanoclaw (single-user).
- Switch backends via `GANGLIA_TYPE` env var (`openclaw` or `nanoclaw`).
- Authentication: `OPENCLAW_API_KEY` for OpenClaw, none for Nanoclaw (localhost).

## Environment Notes
- Workspace root: `/home/ahanyu/code/fletcher`
- Managed by Nix: Use `nix develop` if you need the full Flutter/Android/Bun toolchain.
- Gateway URL: Typically `http://localhost:18789` or `8080` depending on the environment setup.

## Roadmap & Progress
See `tasks/` directory for detailed roadmaps and phase tracking.

## Task Tracking (IMPORTANT)
The `tasks/` directory contains the project roadmap and must stay accurate.

**When to update tasks:**
- After completing a checklist item, mark it `[x]`
- After implementing new functionality, update relevant task files
- When starting significant work, verify task status is current

**Task file conventions:**
- `[ ]` = Not started
- `[x]` = Complete
- `[~]` = Partially complete (add note explaining what's done/remaining)
- Add ✅ to section headers when fully complete

**Structure:**
```
tasks/
├── README.md                 # Overview with epic status
├── 01-infrastructure/        # ✅ Complete
├── 02-livekit-agent/         # Channel plugin tasks
├── 03-flutter-app/           # ✅ Complete
└── 04-livekit-agent-plugin/  # Brain plugin tasks
```

**Before finishing a session:** If you made implementation progress, update the corresponding task file in `tasks/`.

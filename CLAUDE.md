# Fletcher Project - Static's Guide (⚡)

This project (Fletcher) is a voice-first bridge for OpenClaw — a standalone voice agent using LiveKit for real-time conversations.

## Core Directives
- **Runtime:** This is a **Bun** project. Prefer native Bun tools over external ones (e.g., use `bun test` instead of Vitest/Jest).
- **Architecture:** Fletcher is a standalone voice agent that talks to OpenClaw Gateway via its OpenAI-compatible completions API. (We considered the OpenClaw channel plugin approach but opted for standalone — see `docs/architecture-comparison.md`.)
- **Latency Target:** Aim for sub-1.5s voice-to-voice latency.

## Project Structure
- `packages/livekit-agent-ganglia`: The unified Brain Plugin (bridges LiveKit to OpenClaw/Nanoclaw).
- `apps/mobile`: Example Flutter app for testing.

## Documentation & Specs
- Technical specs and integration documents belong in `docs/specs/`.
- Specs are organized by component (mirroring `tasks/` structure): `01-infrastructure/`, `02-livekit-agent/`, `03-flutter-app/`, `04-livekit-agent-plugin/`.
- Do NOT leave spec files in the project root. Move them to the appropriate `docs/specs/` subdirectory.

## Architecture Docs (IMPORTANT)
`docs/architecture/` contains **canonical architecture documentation** — the ground truth for how the system actually works. These are distinct from specs (`docs/specs/`) and tasks (`tasks/`):

| Directory | Purpose | Tense |
|-----------|---------|-------|
| `docs/architecture/` | **What is built** — describes the current system as implemented | Present tense |
| `docs/specs/` | **What was planned** — design proposals and planning artifacts | May be outdated |
| `tasks/` | **What to do next** — roadmap and progress tracking | Forward-looking |

**The architecture docs are the handoff document.** An engineer reading them should be able to understand and replicate the entire stack. Specs and tasks may drift from reality; architecture docs must not.

**Before finishing a PR**, review whether your changes require architecture doc updates:
- **Added/removed a package, service, or major component?** Update `system-overview.md`
- **Changed the voice pipeline (STT, TTS, LLM, AgentSession)?** Update `voice-pipeline.md`
- **Modified Ganglia (factory, backends, streaming, events)?** Update `brain-plugin.md`
- **Changed session routing or SessionKey logic?** Update `session-routing.md`
- **Changed data channel events, transcription, or chunking?** Update `data-channel-protocol.md`
- **Changed the Flutter app (services, widgets, state)?** Update `mobile-client.md`
- **Changed Docker, LiveKit config, Nix, or env vars?** Update `infrastructure.md`
- **Changed the TUI, scripts, or dev commands?** Update `developer-workflow.md`
- **Changed Tailscale or network logic?** Update `network-connectivity.md`

If your change doesn't fit any existing doc, consider whether a new architecture doc is needed. Update `docs/architecture/README.md` if you add or remove documents.

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

**Closing completed tasks:**
When a task is fully complete (`[x]`), move its file into a `_closed/` subdirectory within the epic:
```
tasks/07-ui-ux/
├── EPIC.md
├── 023-open-task.md          # open tasks stay in epic root
└── _closed/
    ├── 016-completed-task.md  # completed tasks go here
    └── 017-completed-task.md
```
- Only move tasks marked `[x]` or `Status: Complete` — NOT `[~]` (partially complete)
- Use `git mv` so git tracks the rename
- Do NOT move `EPIC.md`, `SUMMARY.md`, `mockups/`, or non-task files
- The `_closed/` directory keeps completed tasks accessible but out of the way

**Structure:**
```
tasks/
├── SUMMARY.md                # Overview with epic status (keep in sync!)
├── 01-infrastructure/        # ✅ Complete
├── 02-livekit-agent/         # Voice agent pipeline tasks
├── 03-flutter-app/           # ✅ Complete
├── 04-livekit-agent-plugin/  # Brain plugin tasks
├── 07-ui-ux/                 # TUI Brutalist UI redesign
├── 09-connectivity/          # Connection resilience
└── ...
```

**Before finishing a session:** If you made implementation progress, update the corresponding task file in `tasks/`. If you completed a task, move it to `_closed/`.

**IMPORTANT — Keep SUMMARY.md in sync:** When updating any task file status (marking items `[x]`, `[~]`, or `[ ]`), also update `tasks/SUMMARY.md` to reflect the change. The SUMMARY is the single source of truth for project-wide progress and must match the individual task files.

## Logging Standards
- **No bare `console.*`** in any package or app. Use structured logging instead.
- **All Bun servers** (relay, voice-agent, etc.) must use **`pino`** with **`pino-pretty`** for local dev:
  - JSON output in production (`NODE_ENV=production`).
  - Pretty-printed, colorized output for local dev (auto-detected when `NODE_ENV` is not `production` and `CI` is not set).
  - Control verbosity via `LOG_LEVEL` env var (default: `"info"`).
  - Create child loggers per component: `const log = createLogger("my-component")`.
  - `pino` and `pino-pretty` are workspace-level dependencies in the root `package.json` catalog.
- **Two-tier logging** in `livekit-agent-ganglia`:
  - **`debug` library** (`dbg.*`): Verbose trace-level output for development. Enable with `DEBUG=ganglia:*` or specific namespaces (e.g., `DEBUG=ganglia:openclaw:stream`). Namespaces: `ganglia:factory`, `ganglia:openclaw:stream`, `ganglia:openclaw:client`, `ganglia:nanoclaw:stream`, `ganglia:nanoclaw:client`.
  - **Injected `logger`**: Production-level logging (info/warn/error) via a `Logger` interface. Accepts any console-compatible logger (pino, winston, console). Defaults to silent `noopLogger` when not provided.
- **In apps** (e.g., `voice-agent`, `relay`): Use `pino` with `pino-pretty` transport for local dev. Pass the logger into ganglia via `createGangliaFromEnv({ logger })`.
- **`LLMStream` subclasses** (e.g., `OpenClawChatStream`): Use `this.logger` (inherited from `@livekit/agents` `LLMStream`) for error-level logs. Use `dbg.*` for verbose tracing.
- **What goes where:**
  - `dbg.*`: Request/response details, chunk counts, instanceof checks, session metadata — anything useful for debugging but noisy in production.
  - `this.logger` / injected `logger`: Errors, warnings, key lifecycle events (backend created, stream failed).

## PII & Privacy (IMPORTANT — public repo)
This is a **public repository**. Never commit PII in plaintext.

- **Raw logs** (`docs/field-tests/*.txt.gz`): Gzipped and encrypted via `git-crypt`. Safe to contain PII. Unlock with `git-crypt unlock ./git-crypt-key`, then `gunzip` to read.
- **Buglogs** (`docs/field-tests/*-buglog.md`): Plaintext, publicly visible. **No real names** (use "tester" or initials), **no IP addresses**, **no device serials**. Sanitize log excerpts before pasting.
- **Conversation transcripts**: Never paste full transcripts into public-facing files. Summarize or anonymize.
- **Secrets**: Never commit API keys, tokens, or credentials. Use `.env` files (gitignored).

## Process Cleanup (IMPORTANT)
**Always clean up processes you start.** Before finishing a session or handing back to the user, shut down anything you launched:
- **Android emulator** — `kill $(pgrep -f "emulator|qemu-system")` or `adb emu kill`
- **Flutter run / build** — kill any lingering `flutter`, `gradle`, or `dart` processes
- **Background tasks** — stop any background shells or agents you started
- **App on device** — `adb shell am force-stop com.fletcher.fletcher`

Do NOT leave orphaned emulators, build daemons, or long-running processes behind. Check with `pgrep -fa "emulator|qemu|flutter|gradle|dart"` before wrapping up.

## Commit Discipline (IMPORTANT)
Commit early and often. Do NOT batch up large amounts of work into a single mega-commit at the end.

**When to commit:**
- After adding or updating docs/specs (commit the docs before moving on)
- After a feature or refactor is working and tests pass
- After deleting/renaming files (commit the structural change separately)
- After migrating test frameworks or updating dependencies
- Before starting a different area of work (e.g., commit ganglia changes before starting flutter changes)

**How to commit:**
- Group related changes into logical commits (one concern per commit)
- Use conventional commit prefixes: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`
- Include scope when clear: `feat(ganglia):`, `refactor(channel):`, `docs(tasks):`
- Keep commit messages concise — 1-2 sentence summary of *why*, not *what*

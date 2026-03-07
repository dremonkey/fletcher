# Epic: Terminal UI (tui)

Build a developer-facing CLI and TUI for managing Fletcher's local development environment — service orchestration, startup reliability, and clean shutdown.

## Context

Fletcher's development stack involves multiple services (Docker containers, LiveKit server, Android emulator, the agent process). The TUI provides a unified interface for developers to start, monitor, and stop these services. Early iterations exposed reliability issues with service startup ordering and orphaned processes on exit.

## Tasks

### Phase 1: CLI Entry Point ✅

- [x] **001: `fletcher tui` CLI Entrypoint** — Replace `bun dev` with a proper `fletcher` CLI binary so the TUI can be invoked via `fletcher tui` from anywhere in the repo, with tab-completion support.

### Phase 2: Reliability

- [ ] **002: Reliable One-Shot Service Startup** — Diagnose and fix unreliable "Start dev services" flow by establishing a known-good manual startup sequence and aligning the TUI to match, addressing race conditions and readiness issues.
- [ ] **003: Graceful Ctrl+C Shutdown** — Ensure all resources are properly cleaned up on Ctrl+C: `docker compose down`, emulator termination, and no orphaned processes.

## Status Summary

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | CLI Entry Point | ✅ Complete |
| 2 | Reliability | Not started |

## Dependencies

- **Epic 02 (LiveKit Agent):** The TUI orchestrates agent process startup as part of the dev environment.
- **Epic 03 (Flutter App):** The TUI manages the Android emulator for Flutter development.

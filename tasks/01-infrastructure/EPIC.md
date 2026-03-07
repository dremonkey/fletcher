# Epic: Infrastructure (01-infrastructure)

Set up the foundational development environment — LiveKit server, monorepo structure, cross-platform bootstrap, and remote recovery — so that the voice pipeline has a reliable, reproducible base to build on.

## Context

Fletcher is a voice-first bridge for OpenClaw using LiveKit. Before any voice pipeline work can begin, the development infrastructure must be in place: a containerized LiveKit server, a well-structured monorepo supporting both TypeScript (plugin) and Dart (Flutter app), a cross-platform bootstrap script for environment parity, and a remote recovery mechanism for field-deployed servers.

## Tasks

### Foundation ✅

- [x] **001: Set Up LiveKit Server (Docker)** — Docker Compose configuration for plug-and-play LiveKit server with default development settings.
- [x] **002: Repository Structure & CI/CD** — Monorepo setup (`packages/` + `apps/`) with Bun workspaces for the TypeScript plugin and Flutter for the mobile app. Includes CI/CD, linting, and strict dependency isolation.
- [x] **003: Cross-Platform Bootstrap Script** — Idempotent `scripts/bootstrap.sh` for NixOS and macOS, handling Nix environment, Android SDK, Bun install, and iOS pod install.

### Recovery

- [ ] **004: Remote Reboot Fallback** — Investigate and implement a remote reboot capability (`/fletcher reboot`) for recovering from zombie agent states or fatal pipe hangs in the field.

## Status Summary

| Task | Description | Status |
|------|-------------|--------|
| 001 | LiveKit Server (Docker) | ✅ Complete |
| 002 | Repository Structure & CI/CD | ✅ Complete |
| 003 | Cross-Platform Bootstrap Script | ✅ Complete |
| 004 | Remote Reboot Fallback | Not started |

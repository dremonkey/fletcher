# Epic 23: Relay Native Rewrite (Go or Rust)

**Status:** Backlog — no immediate timeline

## Motivation

The Fletcher Relay (`apps/relay`) is a TypeScript/Bun process that:
- Joins LiveKit rooms as a non-agent participant
- Spawns `openclaw acp` as a subprocess per room
- Bridges LiveKit data channels (JSON-RPC 2.0) to ACP subprocess stdio
- Handles HTTP routes (`/health`, `/relay/join`, `/relay/prompt`, `/webhooks/livekit`)
- Manages idle room cleanup and graceful shutdown

Distributing it currently requires Bun + `node_modules`. A compiled native binary would simplify installation to a single file — download and run, no runtime dependencies.

## Language Candidates

### Go
- **LiveKit SDK:** `livekit/server-sdk-go` is first-class and mature. Supports room participation and data channels (used by `livekit-cli` itself).
- **Stdlib coverage:** HTTP server, JSON parsing, subprocess management (`os/exec`) all in standard library.
- **Ecosystem fit:** `openclaw` is written in Go. Single static binary via `CGO_ENABLED=0`.
- **Trade-off:** Larger binaries (~15-20MB), GC pauses (unlikely to matter for relay workload).

### Rust
- **LiveKit SDK:** `livekit-rust-sdk` exists with room participation and data channel support.
- **Binary size:** Smaller (~5-10MB), no GC, excellent performance.
- **Trade-off:** Higher development effort, steeper learning curve, longer iteration cycles.

**Decision deferred** until work begins. A short spike (Task 001) will prototype both and decide.

## Scope

Full rewrite of all relay functionality:
- HTTP server with `/health`, `/relay/join`, `/relay/prompt`, `/rooms` endpoints
- LiveKit webhook handler (`participant_joined` auto-join)
- LiveKit room join + data channel pub/sub (topic `"relay"`)
- ACP subprocess management (stdin/stdout JSON-RPC 2.0)
- Per-room bridge wiring (data channel <-> ACP)
- Idle room cleanup + graceful shutdown
- Cross-compilation for Linux (amd64, arm64) and macOS (arm64)

## Tasks

- [ ] 001: Language selection spike — prototype LiveKit data channel + ACP subprocess in Go and Rust; compare DX, binary size, SDK maturity
- [ ] 002: Core HTTP server + health endpoint
- [ ] 003: LiveKit room join + data channel pub/sub
- [ ] 004: ACP subprocess management (stdin/stdout JSON-RPC)
- [ ] 005: Bridge wiring (data channel <-> ACP per room)
- [ ] 006: Webhook handler (LiveKit `participant_joined` auto-join)
- [ ] 007: Idle room cleanup + graceful shutdown
- [ ] 008: Build & distribution (cross-compile, release binaries, GitHub Actions)
- [ ] 009: Integration test against existing Flutter app + OpenClaw

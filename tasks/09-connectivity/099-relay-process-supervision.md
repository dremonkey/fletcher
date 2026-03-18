# Task 099: Relay Process Supervision — Auto-Restart on Crash/Signal

## Problem

The relay runs as a bare `bun` process outside Docker with no supervisor, watchdog, or auto-restart. When it dies — whether from SIGTERM, SIGKILL, OOM, or an unhandled exception — it stays dead until manually restarted. During the 2026-03-17 field test, the relay shut down 3 times:

1. **23:20:45 → 23:21:10** (25s gap) — graceful SIGTERM, likely field-test monitor restart
2. **11:12:42 → 11:24:18** (11m 36s gap) — graceful SIGTERM, likely TUI `killPortHolder(7890)` or monitor kill; nobody noticed for 11 minutes
3. **13:42:18 → 13:44:26** (2m 8s gap) — hard crash (no "Shutting down..." log), likely OOM kill or native FFI segfault in `@livekit/rtc-node`

The 11-minute gap left the tester without chat mode or any relay-mediated functionality.

## Root Cause Analysis

### Shutdown sources identified

| Source | Mechanism | Signal |
|--------|-----------|--------|
| TUI cleanup (`packages/tui/src/services.ts:271-285`) | `killPortHolder(7890)` kills ANY process on port 7890 via `ss -tlnp` | SIGTERM |
| Field-test monitor skill | `kill $(pgrep -f "relay/src/index")` per skill instructions | SIGTERM |
| Parent shell exit (nix shell close) | SIGHUP to child processes | SIGHUP (NOT HANDLED) |
| OOM killer / native segfault | Kernel kills process | SIGKILL/SIGSEGV |

### Why shutdown 3 (13:42) had no log

The relay only handles SIGINT and SIGTERM (`index.ts:69`). These produce the "Shutting down..." log. Other kill vectors bypass the handler:
- **SIGHUP** (parent shell exit) — not handled, default behavior is terminate
- **SIGKILL/SIGSEGV** (OOM/segfault) — cannot be caught
- **`uncaughtException`/`unhandledRejection`** handlers (`index.ts:58-66`) call `process.exit(1)` which does NOT log "Shutting down..." (they log "FATAL" instead, which may have been missed)

### Event loop fragility

All relay timers are `unref()`'d (idle timer, discovery timer, bind timeout, session poller). Only `Bun.serve()` keeps the event loop alive. If `Bun.serve()` loses its reference (Bun bug, transient condition), the process exits cleanly with code 0 and NO log.

### Note: ACP SIGKILL is expected

OpenClaw does not support graceful shutdown via SIGTERM — this is a known upstream limitation. The relay's SIGTERM→SIGKILL escalation after 3s is the correct behavior. No action needed.

## Proposed Fix

### Option A: Run relay in Docker (RECOMMENDED)

Add the relay to `docker-compose.yml` with `restart: unless-stopped`. Consistent with all other services.

### Additional hardening (regardless of supervision choice)

1. **Handle SIGHUP**: Add `"SIGHUP"` to the signal handler list in `index.ts:69` so nix shell exits produce a clean shutdown log instead of silent death.
2. **Memory limits**: Set resource limits to prevent OOM impact on host.
3. **Audit async throw paths**: BUG-043 (2026-03-16) found one unguarded `sendNotification()` rejection that crashed the relay. Similar paths may exist in `RelayBridge.forwardToMobile()` / `forwardToVoiceAgent()` dead-forward-path logic (`relay-bridge.ts:788-841`).

## Acceptance Criteria

- [ ] Relay auto-restarts within 5s of unexpected termination
- [ ] Health check endpoint is monitored (Docker healthcheck or systemd watchdog)
- [ ] Logs are preserved across restarts (append to daily log file)
- [ ] SIGHUP handled in `index.ts` signal handler list
- [x] ACP subprocess shutdown — known OpenClaw limitation; SIGKILL fallback is correct

## Files

- `apps/relay/src/index.ts` — shutdown handler, signal handlers, crash handlers
- `docker-compose.yml` — container configuration
- `packages/tui/src/services.ts` — TUI cleanup, `killPortHolder()`
- `apps/relay/src/bridge/bridge-manager.ts` — timer `unref()` patterns
- `apps/relay/src/bridge/relay-bridge.ts` — dead-forward-path logic

## Status

- **Date:** 2026-03-17
- **Priority:** HIGH
- **Bug:** BUG-054
- **Status:** RCA COMPLETE

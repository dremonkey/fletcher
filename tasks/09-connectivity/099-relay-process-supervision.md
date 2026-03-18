# Task 099: Relay Process Supervision — Auto-Restart on Crash/Signal

## Problem

The relay runs as a bare `bun` process outside Docker with no supervisor, watchdog, or auto-restart. When it dies — whether from SIGTERM, SIGKILL, OOM, or an unhandled exception — it stays dead until manually restarted. During the 2026-03-17 field test, the relay shut down 3 times:

1. **23:20:45 → 23:21:10** (25s gap) — graceful shutdown + manual restart
2. **11:12:42 → 11:24:18** (11m 36s gap) — graceful shutdown, nobody noticed for 11 minutes
3. **13:42:18 → 13:44:26** (2m 8s gap) — crash (no "Shutting down..." logged), manual restart

The 11-minute gap left the tester without chat mode or any relay-mediated functionality.

Additionally, all 42 ACP subprocesses spawned during the session required SIGKILL (SIGTERM was ignored), indicating the ACP graceful shutdown path is non-functional.

## Root Cause

- `apps/relay/src/index.ts:69-76`: Graceful shutdown on SIGINT/SIGTERM calls `process.exit(0)` — there is no restart.
- The relay is started via `bun run apps/relay/src/index.ts` as a background process from the TUI or manually.
- No systemd unit, Docker container, or process manager wraps it.
- The 13:42 crash had no "Shutting down..." log, meaning it bypassed the signal handler (likely OOM or unhandled rejection).

## Proposed Fix

### Option A: Run relay in Docker (RECOMMENDED)

Add the relay to `docker-compose.yml` with `restart: unless-stopped`. This gives:
- Auto-restart on crash
- Health check via existing `/health` endpoint
- Log aggregation with other containers
- Resource limits (memory cap to catch leaks early)

### Option B: Watchdog wrapper script

A shell script that restarts the relay on exit:
```bash
while true; do
  bun run apps/relay/src/index.ts >> logs/relay-$(date +%Y-%m-%d).log 2>&1
  echo "Relay exited ($?), restarting in 3s..." >> logs/relay-$(date +%Y-%m-%d).log
  sleep 3
done
```

### Option C: systemd user unit

For NixOS, a `systemd.user.services.fletcher-relay` unit with `Restart=on-failure`.

### Note: ACP SIGKILL is expected

OpenClaw does not support graceful shutdown via SIGTERM — this is a known upstream limitation. The relay's SIGTERM→SIGKILL escalation after 3s is the correct behavior. No action needed.

## Acceptance Criteria

- [ ] Relay auto-restarts within 5s of unexpected termination
- [ ] Health check endpoint is monitored (Docker healthcheck or systemd watchdog)
- [ ] Logs are preserved across restarts (append to daily log file)
- [x] ACP subprocess shutdown — known OpenClaw limitation; SIGKILL fallback is correct

## Files

- `apps/relay/src/index.ts` — shutdown handler
- `docker-compose.yml` — container configuration
- `apps/relay/src/bridge-manager.ts` — ACP lifecycle

## Status

- **Date:** 2026-03-17
- **Priority:** HIGH
- **Bug:** BUG-054
- **Status:** OPEN

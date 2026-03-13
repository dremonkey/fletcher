# Task: Kill relay on TUI shutdown even if manually restarted

## Background

Found during field testing (2026-03-12, BUG-005). After `Ctrl+C` on the TUI,
the relay continues running — occupying port 7890 and keeping ACP subprocesses
alive — if the relay was restarted outside the TUI.

## Root Cause

`services.ts` spawns the relay via `spawn()` and pushes the `Subprocess` handle
into the `children[]` array. `cleanup()` (SIGINT handler) calls `child.kill()`
on every entry. Two failure modes exist:

1. **Relay already running when TUI starts** — `startRelay()` detects port 7890
   is occupied, logs "Relay already running", and returns without adding anything
   to `children`. The pre-existing process is invisible to `cleanup()`.

2. **Relay restarted manually after TUI starts** — TUI holds a stale `Subprocess`
   reference (old PID) in `children`. `cleanup()` kills the dead old PID; the new
   relay has a different PID and is not tracked.

## Proposed Fix

On shutdown, additionally check whether anything is listening on port 7890 and
kill it if so. Options:

- **Pidfile approach** — have the relay write its PID to `~/.fletcher/relay.pid`
  on startup. `cleanup()` reads the pidfile and kills that PID if it differs from
  the tracked child.

- **HTTP shutdown endpoint** — add `POST /shutdown` to the relay. `cleanup()`
  calls it after `child.kill()` to catch any untracked instance.

- **Port-based kill** — `cleanup()` runs `lsof -ti :7890 | xargs kill` as a
  fallback after killing tracked children.

The pidfile approach is cleanest and avoids requiring HTTP round-trips during
shutdown.

## Checklist

- [ ] Relay writes pidfile on startup
- [ ] `cleanup()` reads pidfile and kills that PID if relay is not in `children`
- [ ] Test: start relay manually, then run TUI, then Ctrl+C — relay dies
- [ ] Test: start TUI, kill relay manually, restart relay manually, then Ctrl+C — new relay dies
- [ ] Test: no relay running — cleanup does not error

## Related

- `tasks/tui/003-graceful-shutdown.md` (docker/emulator cleanup — same pattern)
- `apps/relay/src/index.ts` — relay startup
- `apps/tui/src/services.ts` — `startRelay()` and `cleanup()`
- Bug: `docs/field-tests/20260312-buglog.md` BUG-005

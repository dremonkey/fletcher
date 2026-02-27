# Task: Graceful Ctrl+C shutdown (docker compose down + emulator)

## Description

When pressing Ctrl+C after starting services via the TUI, ensure all resources are cleaned up: Docker containers brought down via `docker compose down`, and the Android emulator process is terminated.

## Root Cause (found)

The original handler was `async` and used `await spawn(...).exited` for `docker compose down`.
When Ctrl+C is pressed in a terminal, SIGINT is sent to the **entire foreground process group**
— both the TUI and any child processes (Flutter, emulator). The child exits, which resolves
`await flutterProc.exited` in the main flow, and the module finishes executing. Meanwhile the
async cleanup handler's `await proc.exited` is still pending. The race means `docker compose down`
may never complete (or even start) before the process exits.

## Fix

Changed the cleanup handler from async to **synchronous** using `Bun.spawnSync` for
`docker compose down`. This blocks the signal handler until docker compose finishes,
then calls `process.exit(0)` — the main flow never gets a chance to resume.

## Investigation Areas

### 1. Is the handler installed at the right time?

Check that `installShutdownHandler()` is called early enough — before any services are started. If services start but the handler isn't installed yet, Ctrl+C during startup could leave orphaned containers.

### 2. Are all child processes tracked?

The `children` array in `services.ts` must capture:
- Flutter process (spawned in `mobile.ts`)
- Android emulator process (spawned in `mobile.ts`)
- Any other spawned subprocesses

Verify that `mobile.ts` pushes spawned processes into the shared `children` array.

### 3. Does `docker compose down` actually bring everything down?

If the TUI spawned containers with `docker compose up -d`, then `docker compose down` should stop them. But verify:
- The `cwd` is correct (must be the repo root where `docker-compose.yml` lives)
- No containers are left running after shutdown

### 4. Emulator cleanup

The Android emulator may be started via `emulator -avd <name>`. Killing the process should shut it down, but verify:
- The emulator process is in the `children` array
- SIGTERM is sufficient to stop it gracefully
- No zombie emulator processes remain

### 5. Edge cases

- Ctrl+C pressed during the environment audit (before services start)
- Ctrl+C pressed while Docker is building an image
- Ctrl+C pressed while Flutter is installing on device
- Double Ctrl+C (second press while cleanup is in progress)

## Checklist

- [x] Verify `installShutdownHandler()` is called before any services start
- [x] Verify all spawned child processes (Flutter, emulator) are tracked in `children`
- [x] Verify `docker compose down` runs with correct cwd
- [ ] Test Ctrl+C after full startup — all containers stopped, emulator closed
- [ ] Test Ctrl+C during startup — partial resources cleaned up
- [ ] Test double Ctrl+C — no crash, no orphaned processes
- [x] Fix any gaps found

## Success Criteria

- Single Ctrl+C after TUI startup brings down all Docker containers and kills the emulator
- No orphaned containers or processes after shutdown
- Clean terminal output during shutdown (e.g., "Shutting down Fletcher...")

# TASK-056: Fix ACP Subprocess Leak — `proc.kill()` Fails Silently

**Status:** [x] Complete
**Priority:** High
**Epic:** 22 (Dual-Mode Architecture)
**Origin:** BUG-009 (field test 2026-03-12, session 4)

## Problem

`AcpClient.shutdown()` calls `proc.kill()` (SIGTERM) to terminate the `openclaw` subprocess, but `openclaw` ignores SIGTERM and stays alive. Every bridge teardown (participant disconnect, idle timeout, room cleanup) logs `acp_shutdown` but leaves an orphaned `openclaw` + `openclaw-acp` process pair (~62MB RSS each).

In a 26-minute session, 5 process pairs leaked (10 processes, ~310MB RSS). The relay's `/health` endpoint reports `acpProcesses: 1` because it only tracks the latest reference.

## Evidence

```
PID 2317634 (spawned 22:30, shutdown 22:31): ALIVE — 62MB RSS
PID 2319495 (spawned 22:32, shutdown 22:37): ALIVE — 62MB RSS
PID 2324207 (spawned 22:38, shutdown 22:48): ALIVE — 62MB RSS
PID 2331858 (spawned 22:48, no shutdown):   ALIVE — 62MB RSS
PID 2335268 (spawned 22:52, current active): ALIVE — 62MB RSS
```

16 `acp_spawn` events across the full log; every `acp_shutdown` failed to actually kill the process.

## Root Cause

`apps/relay/src/acp/client.ts:130-152`:
```typescript
const proc = this.proc;
this.proc = null;
try {
  proc.kill();  // SIGTERM — openclaw ignores it
} catch { }     // no verification that process exited
```

`openclaw` does not handle SIGTERM gracefully. The process stays alive, and its child `openclaw-acp` also survives.

## Requirements

- [x] After `proc.kill()` (SIGTERM), wait up to 3s for `proc.exited` to resolve
- [x] If still alive after grace period, escalate to `proc.kill(9)` (SIGKILL)
- [x] Kill the process group (`process.kill(-pid, 'SIGKILL')`) to catch `openclaw-acp` children
- [x] Log a warning if SIGTERM was insufficient and SIGKILL was needed
- [x] Verify `proc.exited` resolves after SIGKILL before returning from `shutdown()`
- [x] In `doReinit()`, call `shutdown()` defensively before spawning a new process (even though the old one should be dead)
- [ ] Add a process count to `/health` that actually counts live child PIDs (not just tracked references)

## Files

- `apps/relay/src/acp/client.ts` — `shutdown()` method
- `apps/relay/src/bridge/relay-bridge.ts` — `doReinit()` method
- `apps/relay/src/http/routes.ts` — `/health` endpoint

## Definition of Done

- [x] `shutdown()` reliably kills the `openclaw` process and all children
- [x] No orphaned processes after 10 bridge create/destroy cycles
- [ ] `/health` reports accurate live process count (deferred — low priority)
- [x] Unit test covering SIGTERM-to-SIGKILL escalation (2 new tests)

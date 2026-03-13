# Task 064f: Remove ACP Backend (AcpLLM/AcpChatStream)

**Epic:** 04 — Ganglia / Brain Plugin
**Status:** [ ]
**Depends on:** 064e
**Blocks:** none

## Goal

After the relay backend is the validated default, remove the direct ACP subprocess backend (`AcpLLM`, `AcpChatStream`) from Ganglia. This eliminates dead code and simplifies the package.

## Context

With `GANGLIA_TYPE=relay` as the default and the relay cleanup (064e) done, the ACP backend is no longer used. The code to remove:

- `packages/livekit-agent-ganglia/src/acp-llm.ts` — `AcpLLM` class
- `packages/livekit-agent-ganglia/src/acp-stream.ts` — `AcpChatStream` class
- Factory registration: `registerGanglia('acp', ...)`
- `createGangliaFromEnv()` `type === 'acp'` branch
- `GangliaConfig` `{ type: 'acp'; acp: AcpConfig }` variant
- `AcpConfig` type (if no other consumers)
- Debug namespaces: `dbg.acpStream`
- Exports: `AcpLLM`, `acp` namespace, `AcpConfig`

The `@fletcher/acp-client` package itself may still be used by the relay — only the Ganglia wrapper is removed.

## Deferred

**Why deferred:** The ACP backend is the current production default. It must remain as a fallback until the relay backend has been validated in production and the Docker cleanup (064e) is complete.

**Revisit when:** After 064e is complete and at least 2 weeks of production use with `GANGLIA_TYPE=relay`.

## Not in scope

- Removing `@fletcher/acp-client` package — still used by the relay's `RelayBridge`
- Removing ACP-related env var parsing from the voice-agent — only relevant if GANGLIA_TYPE=acp

## Relates to

- [064 — Relay-Mediated LLM Backend](064-relay-llm-backend.md) (parent design doc)
- [064e — Relay Cleanup](064e-relay-cleanup.md) (prerequisite)
- [064c — Ganglia RelayLLM Backend](064c-ganglia-relay-backend.md) (replacement)

## Acceptance criteria

- [ ] `acp-llm.ts` deleted
- [ ] `acp-stream.ts` deleted
- [ ] Factory registration for `'acp'` removed
- [ ] `createGangliaFromEnv()` `type === 'acp'` branch removed
- [ ] `GangliaConfig` no longer includes `{ type: 'acp' }` variant
- [ ] `AcpConfig` type removed (or moved if relay needs it)
- [ ] `dbg.acpStream` namespace removed
- [ ] All exports updated — no broken imports
- [ ] All tests pass after removal
- [ ] Default `GANGLIA_TYPE` changed from `'acp'` to `'relay'` in factory

<!--
Status key:
  [ ]  pending
  [~]  in progress
  [x]  done
  [!]  failed / blocked
-->

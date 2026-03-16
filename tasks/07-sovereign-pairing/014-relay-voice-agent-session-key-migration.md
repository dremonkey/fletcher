# TASK-014: Relay + Voice Agent Session Key Migration

## Status
- **Status:** Open
- **Priority:** High
- **Owner:** Unassigned
- **Created:** 2026-03-16
- **Phase:** Phase 4 — Session Key Migration
- **Depends On:** TASK-012 (room join endpoint embeds sessionKey in JWT), TASK-013 (mobile no longer sends session/bind)

## Problem

After Epic 7, the Hub derives `sessionKey` server-side and embeds it in the LiveKit JWT metadata. But the relay currently **requires** `session/bind` from the mobile client to create a bridge (see `apps/relay/src/bridge/bridge-manager.ts`), and the voice agent uses `FLETCHER_OWNER_IDENTITY` env var for session routing (see `packages/livekit-agent-ganglia/src/session-routing.ts`). Both must be updated to consume the new JWT-metadata-based session keys.

This is a **breaking protocol change** that must be handled with backwards compatibility.

## Solution

### Part 1: Relay Migration

Update `apps/relay/src/bridge/bridge-manager.ts`:

1. When a participant joins, read `sessionKey` from `participant.metadata` (JSON: `{"sessionKey": "main"}`)
2. If metadata contains `sessionKey`, create the bridge immediately — no need to wait for `session/bind`
3. **Backwards compatibility:** If metadata does NOT contain `sessionKey` (pre-Epic-7 client), fall back to waiting for `session/bind` as before. This allows gradual rollout.
4. Remove the `session/bind` wait timeout for participants that have JWT metadata (they'll never send it)
5. Update all existing `session/bind` tests to cover both paths (metadata-first and bind-fallback)

### Part 2: Voice Agent Migration

Update `packages/livekit-agent-ganglia/src/session-routing.ts`:

1. `resolveSessionKey()` should check `participant.metadata` for a `sessionKey` field first
2. If metadata contains `sessionKey`, use it directly (no comparison against `FLETCHER_OWNER_IDENTITY`)
3. **Backwards compatibility:** If metadata does NOT contain `sessionKey`, fall back to the existing `FLETCHER_OWNER_IDENTITY` env var comparison
4. Log which resolution path was used (metadata vs env-var) at `debug` level

### Part 3: Deprecation Path

Once all clients are post-Epic-7:
1. Remove `session/bind` handling from relay entirely
2. Remove `FLETCHER_OWNER_IDENTITY` env var from voice agent
3. Remove `session/bind` from `data-channel-protocol.md`

This cleanup is deferred until all active clients have been updated.

## Architecture Impact

```
BEFORE (current):
  Mobile ──session/bind──> Relay ──reads sessionKey──> Bridge
  Mobile ──connects──> LiveKit ──participant identity──> Voice Agent
  Voice Agent ──compares vs FLETCHER_OWNER_IDENTITY──> SessionKey

AFTER (Epic 7):
  Hub ──embeds sessionKey in JWT metadata──> LiveKit JWT
  Mobile ──connects with JWT──> LiveKit ──participant.metadata──> Relay
  Relay ──reads sessionKey from metadata──> Bridge (no session/bind needed)
  Voice Agent ──reads sessionKey from metadata──> SessionKey (no env var needed)

TRANSITION (backwards-compatible):
  Relay: check metadata FIRST → if missing, wait for session/bind
  Voice Agent: check metadata FIRST → if missing, use FLETCHER_OWNER_IDENTITY
```

## Files Modified

- `apps/relay/src/bridge/bridge-manager.ts` — Session key resolution from JWT metadata
- `apps/relay/src/bridge/bridge-manager.spec.ts` — Tests for both resolution paths
- `packages/livekit-agent-ganglia/src/session-routing.ts` — Metadata-first resolution
- `packages/livekit-agent-ganglia/src/session-routing.spec.ts` — Tests for metadata path
- `docs/architecture/data-channel-protocol.md` — Document `session/bind` deprecation
- `docs/architecture/session-routing.md` — Document JWT-metadata resolution

## Acceptance Criteria
- [ ] Relay reads `sessionKey` from participant JWT metadata when available
- [ ] Relay creates bridge without waiting for `session/bind` when metadata is present
- [ ] Relay falls back to `session/bind` for pre-Epic-7 participants (backwards compatible)
- [ ] Voice agent reads `sessionKey` from `participant.metadata` when available
- [ ] Voice agent falls back to `FLETCHER_OWNER_IDENTITY` comparison when metadata is absent
- [ ] Both resolution paths are logged at debug level (which path was used)
- [ ] Existing `session/bind` tests still pass (fallback path)
- [ ] New tests cover the metadata-first path
- [ ] `data-channel-protocol.md` updated to document `session/bind` deprecation
- [ ] `session-routing.md` updated to document JWT-metadata resolution

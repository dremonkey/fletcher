# TASK-014: Voice Agent Session Key Migration (JWT Metadata)

## Status
- **Status:** Open
- **Priority:** High
- **Owner:** Unassigned
- **Created:** 2026-03-16
- **Updated:** 2026-03-16 (eng-manager review: re-scoped to voice agent only)
- **Phase:** Phase 4 — Voice Agent Session Key Migration
- **Depends On:** TASK-012 (room join endpoint embeds sessionKey in JWT)

## Problem

After Epic 7, the Hub derives `sessionKey` server-side and embeds it in the LiveKit JWT metadata. But the voice agent currently uses the `FLETCHER_OWNER_IDENTITY` env var for session routing (see `packages/livekit-agent-ganglia/src/session-routing.ts`). The voice agent must be updated to consume the new JWT-metadata-based session keys.

**Important:** This task does NOT modify the relay. The relay continues using `session/bind` for conversation thread binding (see Architecture Decision 10 in EPIC.md). The JWT metadata `sessionKey` ("main" / "guest_...") and the relay's conversation thread key (`agent:main:relay:<session-name>`) are independent systems serving different purposes.

## Solution

### Part 1: Voice Agent Migration

Add a new function `resolveSessionKeyFromMetadata(participant)` to `packages/livekit-agent-ganglia/src/session-routing.ts`:

1. Read `participant.metadata` (string)
2. If present and valid JSON containing a `sessionKey` field, map it to a `SessionKey`:
   - `"main"` → `{ type: "owner", key: "main" }`
   - `"guest_{deviceId}"` → `{ type: "guest", key: "guest_{deviceId}" }`
3. Return `undefined` if metadata is absent, empty, or not valid JSON (no throw)

In `apps/voice-agent/src/agent.ts` (around the `waitForDeviceParticipant` resolution):
1. Call `resolveSessionKeyFromMetadata(participant)`
2. If it returns a SessionKey, use it
3. If it returns undefined, fall back to `resolveSessionKeySimple()` with `FLETCHER_OWNER_IDENTITY`
4. Log which resolution path was used at `debug` level

### Part 2: Relay — No Changes Needed

The relay continues using `session/bind` for conversation thread binding. The JWT metadata `sessionKey` ("main" / "guest_...") serves a different purpose (owner/guest routing) than the relay's conversation thread key (`agent:main:relay:<session-name>`).

These are independent systems:
- **Voice agent owner/guest routing** (JWT metadata) → determines OpenClaw session scope
- **Relay conversation thread binding** (`session/bind`) → determines ACP subprocess session identity, enables session resumption (Epic 25, TASK-081)

The relay MAY optionally read JWT metadata in the future to differentiate owner vs guest behavior, but this is not needed for MVP.

### Part 3: Deprecation Path

Once all clients are post-Epic-7:
1. Remove `FLETCHER_OWNER_IDENTITY` env var from voice agent (replaced by JWT metadata)
2. Update `session-routing.md` to remove the env-var-based owner detection section

NOTE: `session/bind` is NOT deprecated. It continues to serve relay conversation thread binding (Epic 25, TASK-081).

## Architecture Impact

```
BEFORE (current):
  Voice Agent: compares participant identity vs FLETCHER_OWNER_IDENTITY → SessionKey
  Relay: waits for session/bind → conversation thread key → ACP subprocess

AFTER (Epic 7):
  Voice Agent: reads sessionKey from participant.metadata (JWT claim) → SessionKey
               falls back to FLETCHER_OWNER_IDENTITY if metadata absent
  Relay: unchanged — still uses session/bind → conversation thread key → ACP subprocess

KEY INSIGHT: Two independent session key systems coexist:
  JWT metadata sessionKey  ──→ voice agent owner/guest routing
  session/bind thread key  ──→ relay conversation persistence
```

## Files Modified

- `packages/livekit-agent-ganglia/src/session-routing.ts` — Add `resolveSessionKeyFromMetadata()`
- `packages/livekit-agent-ganglia/src/session-routing.spec.ts` — Tests for metadata-first path
- `apps/voice-agent/src/agent.ts` — Use metadata-first resolution, fall back to env var
- `docs/architecture/session-routing.md` — Document JWT-metadata resolution as primary path
- `docs/architecture/data-channel-protocol.md` — Add clarifying note that `session/bind` is for relay thread binding (not deprecated by Epic 7)

## Acceptance Criteria
- [ ] `resolveSessionKeyFromMetadata()` correctly parses JWT metadata `sessionKey` field
- [ ] `resolveSessionKeyFromMetadata()` returns undefined for missing/invalid metadata (no throw)
- [ ] `resolveSessionKeyFromMetadata()` maps `"main"` to `{ type: "owner", key: "main" }`
- [ ] `resolveSessionKeyFromMetadata()` maps `"guest_{deviceId}"` to `{ type: "guest", key: "guest_{deviceId}" }`
- [ ] Voice agent reads `sessionKey` from `participant.metadata` when available
- [ ] Voice agent falls back to `FLETCHER_OWNER_IDENTITY` comparison when metadata is absent
- [ ] Both resolution paths are logged at debug level (which path was used)
- [ ] Existing session routing tests still pass (fallback path)
- [ ] New tests cover the metadata-first path (valid metadata, invalid JSON, empty string, null)
- [ ] `session-routing.md` updated to document JWT-metadata resolution
- [ ] `data-channel-protocol.md` updated to clarify `session/bind` is for relay thread binding (not deprecated)

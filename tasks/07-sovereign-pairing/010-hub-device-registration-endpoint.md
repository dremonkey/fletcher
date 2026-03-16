# TASK-010: Device Registration Endpoint

## Status
- **Status:** Open
- **Priority:** High
- **Owner:** Unassigned
- **Created:** 2026-03-08
- **Updated:** 2026-03-16 (plan review refinements)
- **Phase:** Phase 1 — Hub Plugin
- **Depends On:** TASK-011 (plugin scaffold provides SQLite stores)

## Spec Reference
- [Vessel Key Pairing Spec](../../docs/specs/vessel-key-pairing-spec.md) — registration request/response schema
- [Phase 1 MVP Spec §1.3-1.4](../../docs/specs/phase-1-mvp-spec.md) — Hub Implementation

## Problem

After scanning a Vessel Key QR code, the mobile app needs to register its device identity with the Hub. The Hub must validate the single-use pairing token and store the device's public key for future authentication.

## Solution

Register `POST /fletcher/devices/register` via `api.registerHttpRoute()` in the `openclaw-plugin-fletcher` plugin (scaffolded in TASK-011).

### Request
```json
{
  "publicKey": "<base64 Ed25519 public key>",
  "deviceModel": "Pixel 8",
  "os": "android",
  "appVersion": "1.0.0"
}
```
Authorization: `Bearer <pairing_token>`

### Behavior
1. Validate pairing token against SQLite token store (check expiry, single-use flag)
2. **Atomically revoke the pairing token** (compare-and-swap: if token is still valid, mark as used in the same transaction). This prevents concurrent registration race conditions where two devices scan the same QR.
3. Generate `device_<16-hex>` device ID (`randomBytes(8).toString('hex')` — 8 bytes = 16 hex chars)
4. Determine owner status: first device registered becomes "owner" (gets `sessionKey: "main"`)
5. Store device identity (deviceId, publicKey, hubId, createdAt, isOwner) in SQLite device store
6. Return `201 { "deviceId": "device_...", "agentName": "Glitch", "serverTime": 1709850600000 }`

The `serverTime` field (Unix milliseconds) allows the client to compute a clock offset for future signed requests (see TASK-012 timestamp verification).

### Error Responses
- `401` — Invalid, expired, or already-used pairing token
- `400` — Missing required fields (publicKey, deviceModel, os, appVersion)
- `409` — Exact same `publicKey` already registered (idempotent retry: returns existing deviceId + agentName). This handles the case where the client's 201 response was lost due to network failure. Note: if a *different* public key was registered using the same pairing token, the token is already revoked and the client gets 401.
- `500` — Internal error (SQLite write failure, etc.) with `requestId` for log correlation

### Device Revocation

Add `vessel-key revoke-device <deviceId>` CLI command (registered via plugin CLI API):
1. Set `revokedAt` timestamp on the device record in SQLite
2. Log the revocation event
3. Next time the revoked device tries `/rooms/join` (TASK-012), it gets 403

This is table-stakes security — if a phone is lost or stolen, the Hub operator must be able to cut off access immediately.

## Implementation Notes

- Uses the SQLite token store and device store initialized by TASK-011
- Token revocation MUST be atomic (single SQLite transaction: check token validity + mark as used + insert device). This prevents the concurrent-scan race condition.
- Device store tracks which device is the "owner" (first registered, or explicitly set via future admin CLI)
- Every error response includes a `requestId` (UUID) for log correlation between Hub and mobile
- Log: token validation result, deviceId generated, owner status, store write success/failure

## Acceptance Criteria
- [ ] `POST /fletcher/devices/register` route registered via `api.registerHttpRoute()`
- [ ] Valid pairing token + payload returns 201 with deviceId, agentName, serverTime
- [ ] Expired token returns 401
- [ ] Already-used token returns 401 (single-use, atomic revocation)
- [ ] Missing fields return 400
- [ ] Already-registered public key returns 409 with existing deviceId
- [ ] Device identity is persisted in SQLite (survives process restart)
- [ ] Pairing token is atomically revoked after successful registration
- [ ] First registered device is marked as owner
- [ ] `vessel-key revoke-device <deviceId>` CLI command works
- [ ] Revoked device gets 403 from `/rooms/join` (TASK-012 integration)
- [ ] Every error response includes `requestId` for log correlation
- [ ] Concurrent registration with same token: exactly one succeeds, other gets 401

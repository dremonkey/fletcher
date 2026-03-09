# TASK-010: Device Registration Endpoint

## Status
- **Status:** Open
- **Priority:** High
- **Owner:** Unassigned
- **Created:** 2026-03-08
- **Phase:** Phase 1 — Hub Plugin
- **Depends On:** TASK-011 (plugin scaffold provides token store and device store)

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
1. Validate pairing token against the plugin's token store (check expiry, single-use flag)
2. Generate `device_<random_hex>` device ID
3. Store device identity (deviceId, publicKey, hubId, createdAt) in the plugin's device store
4. Revoke pairing token (single-use enforcement)
5. Return `201 { "deviceId": "device_...", "agentName": "Glitch" }`

### Error Responses
- `401` — Invalid or expired pairing token
- `400` — Missing required fields

## Implementation Notes

- Uses the token store and device store initialized by TASK-011's plugin scaffold
- Token storage can be in-memory for MVP, SQLite for durability
- Device store should be queryable by deviceId for signature verification (TASK-012)

## Acceptance Criteria
- [ ] `POST /fletcher/devices/register` route registered via `api.registerHttpRoute()`
- [ ] Valid pairing token + payload returns 201 with deviceId
- [ ] Expired token returns 401
- [ ] Already-used token returns 401 (single-use)
- [ ] Missing fields return 400
- [ ] Device identity is persisted (survives process restart)
- [ ] Pairing token is revoked after successful registration

# TASK-012: Room Join Endpoint

## Status
- **Status:** Open
- **Priority:** High
- **Owner:** Unassigned
- **Created:** 2026-03-08
- **Phase:** Phase 1 — Hub Plugin
- **Depends On:** TASK-010 (device registration provides the device store with public keys)

## Spec Reference
- [Vessel Key Pairing Spec](../../docs/specs/vessel-key-pairing-spec.md) — authentication flow
- [Phase 1 MVP Spec §3.2](../../docs/specs/phase-1-mvp-spec.md) — Authentication Flow

## Problem

After pairing, the mobile app needs to authenticate with the Hub to obtain a LiveKit room token. The current approach uses hardcoded tokens or a separate `bun run token:generate` flow.

## Solution

Register `POST /fletcher/rooms/join` via `api.registerHttpRoute()` in the `openclaw-plugin-fletcher` plugin.

### Request
```json
{
  "deviceId": "device_...",
  "roomName": "fletcher-device_...",
  "timestamp": 1709850600000,
  "signature": "<base64 Ed25519 signature of 'deviceId:roomName:timestamp'>"
}
```

### Behavior
1. Look up device by `deviceId` in the plugin's device store — return 404 if not found
2. Verify Ed25519 signature against stored public key
3. Check timestamp is within 60 seconds (anti-replay)
4. Generate LiveKit `AccessToken` with room join grant
5. Return `200 { "token": "<jwt>" }`

### Dependencies (Hub)
- `livekit-server-sdk` — AccessToken generation
- `@noble/ed25519` — Signature verification

## Implementation Notes

- The device store is shared with TASK-010 — devices registered there are looked up here
- The plugin context provides access to LiveKit API key/secret for token generation
- Room names follow the `fletcher-<deviceId>` convention (Phase 1 simplicity)

## Acceptance Criteria
- [ ] `POST /fletcher/rooms/join` route registered via `api.registerHttpRoute()`
- [ ] Valid signature + timestamp returns 200 with LiveKit JWT
- [ ] Unknown deviceId returns 404
- [ ] Invalid signature returns 401
- [ ] Stale timestamp (>60s) returns 401
- [ ] Generated token grants roomJoin, canPublish, canSubscribe
- [ ] Token identity matches the deviceId

# TASK-012: Room Join Endpoint

## Status
- **Status:** Open
- **Priority:** High
- **Owner:** Unassigned
- **Created:** 2026-03-08
- **Updated:** 2026-03-16 (plan review refinements)
- **Phase:** Phase 1 — Hub Plugin
- **Depends On:** TASK-010 (device registration provides the device store with public keys), Spike B (crypto interop verified)

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

**Note:** `timestamp` is Unix milliseconds (aligns with JS `Date.now()` and Dart `DateTime.now().millisecondsSinceEpoch`).

### Behavior
1. Look up device by `deviceId` in the plugin's device store — return 404 if not found
2. Check device is not revoked (`revokedAt` is null) — return 403 if revoked
3. Verify Ed25519 signature against stored public key
4. Check timestamp is within ±120 seconds of server time (anti-replay with clock-skew tolerance for self-hosted Hubs with imperfect NTP). The client uses the clock offset computed during registration (see TASK-010 `serverTime` field) to align its timestamp.
5. **Derive session key from device identity** — if `deviceId` matches the Hub's owner device (the device that first paired), assign `sessionKey: "main"`; otherwise assign `sessionKey: "guest_{deviceId}"`
6. Generate LiveKit `AccessToken` with room join grant and **embed `sessionKey` in JWT metadata**
7. Return `200 { "token": "<jwt>" }`

### Session Key Derivation (Server-Side)

The Hub derives the session key at token issuance time — the relay and mobile client never choose it themselves. This eliminates a class of spoofing attacks where a malicious client claims `sessionKey: "main"` to hijack the owner's conversation context.

**Why server-side?** Inspired by [MobVibe](https://github.com/Eric-Song-Nop/mobvibe)'s auth architecture, where the gateway verifies device identity via registered Ed25519 public keys and the client never self-asserts its access level. We adapt the same principle: the Hub is the sole authority on device→role mapping, and the session key is a server-derived claim, not a client-provided input.

**How it works:**
- Hub device store tracks which device is the "owner" (first device registered, or explicitly designated)
- On room join, Hub checks `deviceId` against owner record
- Session key is embedded in the LiveKit JWT `metadata` field as JSON: `{"sessionKey": "main"}` or `{"sessionKey": "guest_device_abc123"}`
- Relay reads `sessionKey` from the joining participant's JWT metadata — never from data channel messages (see TASK-014)
- Voice agent reads `sessionKey` from `participant.metadata` — never from `FLETCHER_OWNER_IDENTITY` env var (see TASK-014)

### Clock Skew Handling

Self-hosted Hubs may have imperfect NTP. To handle clock skew:
1. During registration (TASK-010), the Hub returns `serverTime` in the response
2. The mobile client computes `clockOffset = serverTime - localTime` and stores it
3. On each room join, the client uses `Date.now() + clockOffset` as the timestamp
4. The Hub verifies `|serverNow - requestTimestamp| < 120_000ms`

This makes the system resilient to clock differences up to the registration-time offset magnitude, with a 120-second grace window on top.

### Error Responses
- `404` — Unknown deviceId
- `403` — Device has been revoked
- `401` — Invalid signature or stale timestamp (>120s)
- `500` — Internal error (LiveKit API key misconfigured, etc.) with `requestId`

### Dependencies (Hub)
- `livekit-server-sdk` — AccessToken generation
- `@noble/ed25519` — Signature verification (interop with Dart `cryptography` package verified by Spike B)

## Implementation Notes

- The device store is shared with TASK-010 — devices registered there are looked up here
- The plugin context provides access to LiveKit API key/secret for token generation
- Room names follow the `fletcher-<deviceId>` convention (Phase 1 simplicity)
- **Challenge string format:** `${deviceId}:${roomName}:${timestamp}` — no nonce needed because the timestamp provides uniqueness within the replay window
- Log: deviceId, signature valid/invalid, timestamp delta from server, sessionKey derived, JWT TTL

## Acceptance Criteria
- [ ] `POST /fletcher/rooms/join` route registered via `api.registerHttpRoute()`
- [ ] Valid signature + timestamp returns 200 with LiveKit JWT
- [ ] Unknown deviceId returns 404
- [ ] Revoked device returns 403
- [ ] Invalid signature returns 401
- [ ] Stale timestamp (>120s from server time) returns 401
- [ ] Generated token grants roomJoin, canPublish, canSubscribe
- [ ] Token identity matches the deviceId
- [ ] Owner device gets JWT with `metadata: {"sessionKey": "main"}`
- [ ] Non-owner device gets JWT with `metadata: {"sessionKey": "guest_{deviceId}"}`
- [ ] Device store tracks which device is the owner (first registered or explicitly set)
- [ ] Every error response includes `requestId` for log correlation
- [ ] Clock offset tolerance: a client with 90s clock skew still authenticates (if it uses the offset from registration)

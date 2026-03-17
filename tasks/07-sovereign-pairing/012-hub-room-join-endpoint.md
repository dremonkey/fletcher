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
4. **Derive session key from device identity** — if `deviceId` matches the Hub's owner device (the device that first paired), assign `sessionKey: "main"`; otherwise assign `sessionKey: "guest_{deviceId}"`
5. Generate LiveKit `AccessToken` with room join grant and **embed `sessionKey` in JWT metadata**
6. Return `200 { "token": "<jwt>" }`

### Session Key Derivation (Server-Side)

The Hub derives the session key at token issuance time — the relay and mobile client never choose it themselves. This eliminates a class of spoofing attacks where a malicious client claims `sessionKey: "main"` to hijack the owner's conversation context.

**Why server-side?** Inspired by [MobVibe](https://github.com/Eric-Song-Nop/mobvibe)'s auth architecture, where the gateway verifies device identity via registered Ed25519 public keys and the client never self-asserts its access level. MobVibe's CLI daemon registers a keypair on setup; the gateway verifies every connection against stored public keys before granting access. We adapt the same principle: the Hub is the sole authority on device→role mapping, and the session key is a server-derived claim, not a client-provided input.

**How it works:**
- Hub device store tracks which device is the "owner" (first device registered, or explicitly designated)
- On room join, Hub checks `deviceId` against owner record
- Session key is embedded in the LiveKit JWT `metadata` field as JSON: `{"sessionKey": "main"}` or `{"sessionKey": "guest_device_abc123"}`
- Relay reads `sessionKey` from the joining participant's JWT metadata — never from data channel messages
- This replaces the current flow where mobile sends `session/bind` with a self-asserted session key

### Dependencies (Hub)
- `livekit-server-sdk` — AccessToken generation
- `@noble/ed25519` — Signature verification

## Implementation Notes

- The device store is shared with TASK-010 — devices registered there are looked up here
- The plugin context provides access to LiveKit API key/secret for token generation
- Room names follow the `fletcher-<deviceId>` convention (Phase 1 simplicity)

## Architecture Doc Updates
- **`session-routing.md`** — **Major rewrite.** Document server-side session key derivation (Hub embeds `sessionKey` in JWT metadata). Replace client-side `resolveSessionKeySimple()` + `FLETCHER_OWNER_IDENTITY` resolution algorithm. Update Owner Detection, Agent Wiring diagram, and Wire Protocol sections.
- **`voice-pipeline.md`** — Update startup sequence step 5: session key now read from participant JWT metadata, not resolved locally via `resolveSessionKeySimple()`.
- **`brain-plugin.md`** — Update `setSessionKey()` calling pattern (voice agent reads session key from JWT metadata instead of resolving it).
- **`infrastructure.md`** — Deprecate `FLETCHER_OWNER_IDENTITY` from env var reference. Document `POST /fletcher/rooms/join` endpoint.

## Acceptance Criteria
- [ ] `POST /fletcher/rooms/join` route registered via `api.registerHttpRoute()`
- [ ] Valid signature + timestamp returns 200 with LiveKit JWT
- [ ] Unknown deviceId returns 404
- [ ] Invalid signature returns 401
- [ ] Stale timestamp (>60s) returns 401
- [ ] Generated token grants roomJoin, canPublish, canSubscribe
- [ ] Token identity matches the deviceId
- [ ] Owner device gets JWT with `metadata: {"sessionKey": "main"}`
- [ ] Non-owner device gets JWT with `metadata: {"sessionKey": "guest_{deviceId}"}`
- [ ] Device store tracks which device is the owner (first registered or explicitly set)

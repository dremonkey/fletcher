# TASK-013: Mobile Client Managed Connection (Hub Auth + Network Fallback)

## Status
- **Status:** Open
- **Priority:** High
- **Owner:** Unassigned
- **Created:** 2026-03-08
- **Phase:** Phase 3 — Managed Connection
- **Depends On:** TASK-009, TASK-012

## Spec Reference
- [Phase 1 MVP Spec §3.2-3.4](../../docs/specs/phase-1-mvp-spec.md) — Authentication Flow, Network Fallback

## Problem

After pairing, the mobile app needs to authenticate with the Hub using Ed25519 signatures, obtain a LiveKit room token, and connect. It should also handle network fallback (mDNS → Tailscale).

## Solution

### HubAuthService
Create `lib/services/hub_auth_service.dart`:
1. Load credentials from `FlutterSecureStorage` (hub URL, device ID, private key)
2. Generate Ed25519 signature of `deviceId:roomName:timestamp`
3. POST to `/fletcher/rooms/join` with signed request
4. Return the JWT token

### Room Naming
Use deterministic room name: `fletcher-$deviceId` (Phase 1 simplicity)

### Network Fallback
Integrate with Epic 9's TCP-race URL resolution (09-connectivity/008+018):
1. Race LAN gateway URL against Tailscale IP — whichever connects first wins
2. Reuses the `UrlResolver` infrastructure already built for connectivity resilience

### LiveKitService Update
Update `joinRoom()` to use `HubAuthService` for token acquisition instead of hardcoded/manual tokens. This replaces the current `bun run token:generate` flow with automatic, authenticated connections.

### Session Key from JWT (No More Client-Side Assertion)
The Hub now embeds `sessionKey` in the LiveKit JWT metadata at token issuance time (see TASK-012). The mobile client **no longer sends `session/bind`** with a self-asserted session key. Instead:
1. Mobile obtains JWT from Hub (which derives session key server-side based on device identity)
2. Mobile connects to LiveKit room with Hub-issued JWT
3. Relay reads `sessionKey` from the participant's JWT metadata
4. Mobile can remove `session/bind` from the data channel protocol entirely

This follows the same trust model as [MobVibe](https://github.com/Eric-Song-Nop/mobvibe), where the relay/gateway is the identity authority and clients never self-assert their access level. The key difference: MobVibe verifies identity per-connection via signed Socket.io tokens; Fletcher verifies identity per-room-join via signed HTTP requests, with the session key baked into the resulting LiveKit JWT.

## Acceptance Criteria
- [ ] `HubAuthService` generates valid Ed25519 signatures
- [ ] Room token is obtained from Hub via authenticated request
- [ ] LiveKit room connection uses Hub-issued token
- [ ] Network fallback: mDNS URL tried first, Tailscale IP as backup
- [ ] Fallback timeout is 2 seconds
- [ ] Device identity in room metadata matches `deviceId`
- [ ] Connection works on both local network and Tailscale
- [ ] Mobile does NOT send `session/bind` — session key comes from JWT metadata
- [ ] Relay reads `sessionKey` from participant JWT metadata, not data channel

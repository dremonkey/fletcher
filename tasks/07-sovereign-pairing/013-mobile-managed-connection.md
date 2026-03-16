# TASK-013: Mobile Client Managed Connection (Hub Auth + Network Fallback)

## Status
- **Status:** Open
- **Priority:** High
- **Owner:** Unassigned
- **Created:** 2026-03-08
- **Updated:** 2026-03-16 (plan review refinements)
- **Phase:** Phase 3 — Managed Connection
- **Depends On:** TASK-009, TASK-012

## Spec Reference
- [Phase 1 MVP Spec §3.2-3.4](../../docs/specs/phase-1-mvp-spec.md) — Authentication Flow, Network Fallback

## Problem

After pairing, the mobile app needs to authenticate with the Hub using Ed25519 signatures, obtain a LiveKit room token, and connect. It should also handle network fallback (LAN → Tailscale).

## Solution

### HubAuthService
Create `lib/services/hub_auth_service.dart`:
1. Load credentials from `CredentialStorage` (hub URL, device ID, private key, clock offset)
2. Compute clock-adjusted timestamp: `DateTime.now().millisecondsSinceEpoch + clockOffset`
3. Construct challenge string: `$deviceId:$roomName:$timestamp`
4. Generate Ed25519 signature of the challenge string
5. POST to `/fletcher/rooms/join` with signed request
6. Return the JWT token

### Room Naming
Use deterministic room name: `fletcher-$deviceId` (Phase 1 simplicity). This means each device gets its own persistent room — session continuity comes from always joining the same room.

### Network Fallback
Integrate with Epic 9's TCP-race URL resolution (09-connectivity/008+018):
1. Race LAN gateway URL against Tailscale IP — whichever connects first wins
2. Reuses the `UrlResolver` infrastructure already built for connectivity resilience
3. 2-second timeout before falling back to the slower path

### LiveKitService Update
Update `joinRoom()` / `connectWithDynamicRoom()` to use `HubAuthService` for token acquisition instead of the current `TokenService`. This replaces the `bun run token:generate` flow with automatic, authenticated connections.

The current `TokenService` is no longer needed after this task. Remove it or gate it behind an unpaired-mode check for development convenience.

### Session Key from JWT (No More Client-Side Assertion)
The Hub now embeds `sessionKey` in the LiveKit JWT metadata at token issuance time (see TASK-012). The mobile client **no longer sends `session/bind`** with a self-asserted session key. Instead:
1. Mobile obtains JWT from Hub (which derives session key server-side based on device identity)
2. Mobile connects to LiveKit room with Hub-issued JWT
3. Relay and voice agent read `sessionKey` from the participant's JWT metadata (see TASK-014)
4. Remove `session/bind` send from mobile data channel protocol

### Device Identity
After pairing, use the Hub-assigned `deviceId` (from `CredentialStorage`) as the LiveKit participant identity. This replaces the hardware-derived `device-<ANDROID_ID>`.

### Error Handling
- **Hub unreachable (both LAN and Tailscale):** Show "Cannot find your Hub on any network." with network diagnostics (which URLs were tried, which failed).
- **Auth failure (401/403/404):** Map to specific user messages:
  - 401: "Authentication failed. Try unpairing and re-scanning."
  - 403: "This device has been revoked. Contact your Hub admin."
  - 404: "Device not recognized. Try unpairing and re-scanning."
- **LiveKit connect failure:** Standard reconnect flow (existing infrastructure)

## Acceptance Criteria
- [ ] `HubAuthService` generates valid Ed25519 signatures with clock-adjusted timestamps
- [ ] Room token is obtained from Hub via authenticated request
- [ ] LiveKit room connection uses Hub-issued token
- [ ] Network fallback: LAN URL tried first, Tailscale IP as backup via TCP race
- [ ] Fallback timeout is 2 seconds (matches existing `UrlResolver` pattern)
- [ ] Participant identity in LiveKit is the Hub-assigned `deviceId`
- [ ] Connection works on both local network and Tailscale
- [ ] Mobile does NOT send `session/bind` — session key comes from JWT metadata
- [ ] `session/bind` send code is removed from mobile data channel protocol
- [ ] Auth errors show specific user-facing messages (401 vs 403 vs 404)
- [ ] Hub unreachable shows network diagnostic info
- [ ] Room name follows `fletcher-$deviceId` pattern

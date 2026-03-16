# TASK-013: Mobile Client Managed Connection (Hub Auth + Network Fallback)

## Status
- **Status:** Open
- **Priority:** High
- **Owner:** Unassigned
- **Created:** 2026-03-08
- **Updated:** 2026-03-16 (plan review + eng-manager refinements)
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

**Fallback if UrlResolver is not available:** If Epic 9 tasks 008+018 are not yet field-verified, use a simple sequential fallback: try LAN URL with 2s timeout, then try Tailscale IP.

### LiveKitService Update
Update `joinRoom()` / `connectWithDynamicRoom()` to use `HubAuthService` for token acquisition instead of the current `TokenService`.

**TokenService gating (not removal):** Gate `TokenService` behind an unpaired-mode check. When Hub credentials exist in `CredentialStorage`, use `HubAuthService`. Otherwise, fall back to `TokenService` for development convenience (developers who haven't set up the Hub plugin can continue working with `bun run token:generate`). Eventually `TokenService` can be removed when all developers use paired mode.

### Session Key from JWT (Server-Derived Owner/Guest Routing)
The Hub now embeds `sessionKey` in the LiveKit JWT metadata at token issuance time (see TASK-012). The voice agent reads owner/guest routing from JWT metadata instead of `FLETCHER_OWNER_IDENTITY` (see TASK-014). However, the mobile client **continues sending `session/bind`** to the relay for conversation thread binding (the `agent:main:relay:<session-name>` key from Epic 25). These are independent session key systems:
1. JWT metadata `sessionKey` ("main" / "guest_...") → voice agent owner/guest routing
2. `session/bind` data channel (`agent:main:relay:<session-name>`) → relay conversation thread persistence

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
- [ ] Sequential fallback works if UrlResolver is unavailable
- [ ] Participant identity in LiveKit is the Hub-assigned `deviceId`
- [ ] Connection works on both local network and Tailscale
- [ ] Mobile continues sending `session/bind` to relay for conversation thread binding
- [ ] JWT metadata provides owner/guest routing to voice agent (no mobile change needed for this)
- [ ] `TokenService` is gated behind unpaired-mode check (not removed)
- [ ] Auth errors show specific user-facing messages (401 vs 403 vs 404)
- [ ] Hub unreachable shows network diagnostic info
- [ ] Room name follows `fletcher-$deviceId` pattern

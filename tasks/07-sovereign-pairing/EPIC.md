# Epic: Sovereign Pairing & Hub Integration (07-sovereign-pairing)

Secure, zero-config onboarding: a fresh Fletcher app pairs with a self-hosted Heirloom Hub by scanning a QR code — no manual URLs, no cloud accounts, no typing.

## Context

An App Store user downloads Fletcher and sees a blank slate. Their Hub (OpenClaw) is running on a home server, reachable over LAN or Tailscale. The onboarding story:

1. **Hub operator** installs the `openclaw-plugin-fletcher` plugin and runs `vessel-key generate` — a QR code appears in the terminal.
2. **Mobile user** opens Fletcher, scans the QR code with the camera.
3. **App** generates an Ed25519 keypair, registers with the Hub using the pairing token, and stores credentials securely.
4. **App** authenticates future sessions by signing requests with the device key — no tokens to copy, no URLs to type.

All pairing data stays local. The Hub never phones home.

## Specs

- [Sovereign Pairing Protocol](../../docs/specs/07-sovereign-pairing.md) — original protocol design
- [Vessel Key Pairing Spec](../../docs/specs/vessel-key-pairing-spec.md) — payload format, registration flow, auth handshake
- [Phase 1 MVP Spec](../../docs/specs/phase-1-mvp-spec.md) — end-to-end implementation plan

## Tasks

### Phase 1: Hub Plugin

Build `openclaw-plugin-fletcher` — an OpenClaw plugin that provides vessel key generation, device registration, and room join endpoints.

- [ ] **011: OpenClaw Plugin Scaffold + Vessel Key Generation** — Create the plugin package (`openclaw-plugin-fletcher`); implement `vessel-key generate` CLI command with QR output and 15-min pairing tokens.
- [ ] **010: Device Registration Endpoint** — `POST /fletcher/devices/register` via `api.registerHttpRoute()`; validate pairing token, store device identity, revoke token.
- [ ] **012: Room Join Endpoint** — `POST /fletcher/rooms/join` via `api.registerHttpRoute()`; Ed25519 signature verification, LiveKit token generation.

### Phase 2: Mobile Client

QR scanning and device identity on the Flutter app. Can be built in parallel with Phase 1.

- [ ] **008: QR Code Scanner for Vessel Key Pairing** — Blank slate detection, `mobile_scanner` QR scanning, Vessel Key JSON parsing/validation.
- [ ] **009: Ed25519 Keypair Generation & Device Registration** — Generate keypair, POST to Hub registration endpoint (from 010), store credentials in FlutterSecureStorage.

### Phase 3: Managed Connection

Replace the current `bun run token:generate` flow with authenticated, automatic connections.

- [ ] **013: Mobile Managed Connection** — `HubAuthService` with Ed25519 auth; network fallback integrates with Epic 9's TCP-race URL resolution (TASK-008/018).

## Status Summary

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Hub Plugin (011, 010, 012) | Not started |
| 2 | Mobile Client (008, 009) | Not started |
| 3 | Managed Connection (013) | Not started |

## Dependencies

```
011 (plugin scaffold + vessel key)
 └→ 010 (device registration endpoint)
     └→ 012 (room join endpoint)

008 (QR scanner)          ← independent, parallel with Phase 1
 └→ 009 (keypair + registration)
     ├── needs 010 (registration endpoint must exist)
     └→ 013 (managed connection)
         └── needs 012 (room join endpoint must exist)
```

- **Epic 9 (Connectivity):** TASK-013 reuses the TCP-race URL resolution from 09-connectivity/008+018.
- **OpenClaw Plugin SDK:** Phase 1 tasks depend on the OpenClaw plugin API (`api.registerHttpRoute()`, `api.registerCommand()`, stores).

## Closed / Superseded Tasks

Tasks 001–007 from the original EPIC.md are retired:
- **001–003** (protocol spec, token endpoint, LiveKit integration) were completed as part of the early prototype and are marked ✅ in SUMMARY.md.
- **004–007** (vessel key spec, blank slate UI, camera handshake, bridge skill) were abstract placeholders that never had task files. Their scope is now covered by the concrete tasks 008–013.

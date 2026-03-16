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

- [Sovereign Pairing Protocol](../../docs/specs/07-sovereign-pairing.md) — original protocol design (NOTE: endpoint paths and challenge format superseded by tasks below)
- [Vessel Key Pairing Spec](../../docs/specs/vessel-key-pairing-spec.md) — payload format, registration flow, auth handshake
- [Phase 1 MVP Spec](../../docs/specs/phase-1-mvp-spec.md) — end-to-end implementation plan

**WARNING — Timestamp units:** The older specs above use Unix **seconds** for timestamps. Tasks 008–014 supersede those specs — all timestamps are Unix **milliseconds**. Do not copy timestamp logic from the older specs.

## Architecture Decisions

These decisions are final and should not be revisited during implementation:

1. **Server-side session key derivation.** The Hub derives `sessionKey` from device identity at token-issuance time. The mobile client never chooses or asserts its own owner/guest routing key. This eliminates spoofing attacks where a malicious client claims `sessionKey: "main"`.

2. **Ed25519 for device auth** (not shared secrets, not JWTs). Devices hold private keys; Hub stores public keys. No secret crosses the wire after pairing.

3. **Single-use pairing tokens** with 15-minute expiry. Token is revoked atomically on first successful registration.

4. **QR code for zero-config onboarding** with manual JSON-paste fallback (first-class, not afterthought).

5. **FlutterSecureStorage** for credential storage — iOS Keychain (Secure Enclave), Android Keystore (TEE/StrongBox). Never SharedPreferences for secrets.

6. **SQLite for Hub stores** — both pairing token store and device store use SQLite from day 1. In-memory stores lose data on Hub restart (unacceptable even for MVP).

7. **Timestamps in milliseconds everywhere.** Both Vessel Key `tokenExpiry` and room-join `timestamp` fields use Unix milliseconds. Aligns with JS `Date.now()` and Dart `DateTime.now().millisecondsSinceEpoch`.

8. **Hub-assigned deviceId is the participant identity.** After pairing, `device_<16-hex>` from the Hub replaces the hardware-derived `device-<ANDROID_ID>` for all LiveKit connections. The mobile app checks secure storage first, falls back to hardware ID only when unpaired.

9. **Plugin lives at `packages/openclaw-plugin-fletcher/`** inside the Fletcher monorepo (auto-discovered by workspace glob). Can be extracted to its own repo later when the plugin API stabilizes.

10. **Two distinct session key concepts coexist.** The voice agent uses JWT-metadata `sessionKey` (values: `"main"` or `"guest_{deviceId}"`) for owner/guest routing to the OpenClaw brain. The relay uses `session/bind` data channel message with a conversation-thread key (format: `agent:main:relay:<session-name>`) for OpenClaw conversation persistence. These are independent systems serving different purposes. Epic 7 introduces the first; Epic 25 (TASK-081) introduced the second. Neither replaces the other.

## Pre-Implementation Requirements

Before starting any task, these two spikes must be completed:

### Spike A: OpenClaw Plugin API Verification

Verify that the OpenClaw plugin SDK supports:
- `api.registerHttpRoute()` for HTTP endpoints
- `api.registerCommand()` for CLI extensions
- Data persistence (SQLite or equivalent) accessible to plugins
- Plugin discovery and loading at runtime

Build a minimal "hello world" plugin that registers one route and one command. **Go/no-go decision point:** If the plugin API is insufficient, the fallback is a standalone HTTP server at `packages/fletcher-hub/` instead of a plugin (changes deployment model but not the pairing protocol).

Also determine: where is the OpenClaw plugin SDK documented? What is the actual API surface (not assumed)?

### Spike B: Cross-Platform Ed25519 Interop Test

Produce a `tests/crypto-interop/` directory with:
1. A Dart test that generates an Ed25519 keypair, signs the challenge format `deviceId:roomName:timestamp`, and writes `fixtures/dart-signed.json` (publicKey, challenge, signature — all base64)
2. A TypeScript test that reads the Dart fixture and verifies the signature using `@noble/ed25519`
3. Vice versa: TypeScript generates + signs, Dart verifies
4. Verify that `utf8.encode(challenge)` in Dart and `Buffer.from(challenge)` in Node.js produce identical byte sequences
5. Document the exact byte format of the private key (32-byte seed vs 64-byte expanded key) and verify `Ed25519().newKeyPairFromSeed()` roundtrip in Dart
6. Verify Ed25519-to-X25519 conversion works in Dart `cryptography` package (needed for Epic 27 E2EE key agreement)

Both tests should be runnable in CI.

## Tasks

### Phase 1: Hub Plugin

Build `openclaw-plugin-fletcher` at `packages/openclaw-plugin-fletcher/` — an OpenClaw plugin that provides vessel key generation, device registration, and room join endpoints.

- [ ] **011: OpenClaw Plugin Scaffold + Vessel Key Generation** — Create the plugin package; implement `vessel-key generate` CLI command with QR output and 15-min pairing tokens. SQLite-backed token and device stores. Plugin config includes `agentName`.
- [ ] **010: Device Registration Endpoint** — `POST /fletcher/devices/register` via `api.registerHttpRoute()`; validate pairing token, store device identity, revoke token atomically. Includes device revocation CLI command. Registration response includes `agentName` and server timestamp (for clock offset calculation).
- [ ] **012: Room Join Endpoint** — `POST /fletcher/rooms/join` via `api.registerHttpRoute()`; Ed25519 signature verification, server-side session key derivation, LiveKit token generation with `sessionKey` in JWT metadata.

### Phase 2: Mobile Client

QR scanning and device identity on the Flutter app. Can be built in parallel with Phase 1.

- [ ] **008: QR Code Scanner for Vessel Key Pairing** — Blank slate detection, `mobile_scanner` QR scanning, Vessel Key JSON parsing/validation. Includes unpair/factory-reset flow.
- [ ] **009: Ed25519 Keypair Generation & Device Registration** — Generate keypair, POST to Hub registration endpoint (from 010), store credentials in FlutterSecureStorage. Hub-assigned `deviceId` becomes participant identity.

### Phase 3: Managed Connection

Replace the current `bun run token:generate` flow with authenticated, automatic connections.

- [ ] **013: Mobile Managed Connection** — `HubAuthService` with Ed25519 auth; network fallback integrates with Epic 9's TCP-race URL resolution. `TokenService` gated behind unpaired-mode check for dev convenience.

### Phase 4: Voice Agent Session Key Migration

Update voice agent to consume server-derived session keys from JWT metadata. Relay is **unchanged** — continues using `session/bind` for conversation thread binding (per Architecture Decision 10).

- [ ] **014: Voice Agent Session Key Migration** — Voice agent reads `sessionKey` from `participant.metadata` (JWT claim from Hub) instead of comparing against `FLETCHER_OWNER_IDENTITY` env var. Backwards-compatible: falls back to env var for pre-Epic-7 participants. Relay is unchanged.

## Status Summary

| Phase | Description | Status |
|-------|-------------|--------|
| Spikes | Plugin API + Crypto Interop | Not started |
| 1 | Hub Plugin (011, 010, 012) | Not started |
| 2 | Mobile Client (008, 009) | Not started |
| 3 | Managed Connection (013) | Not started |
| 4 | Voice Agent Migration (014) | Not started |

## Dependencies

```
[Spike A: Plugin API] ─── gates ──→ Phase 1
[Spike B: Crypto Interop] ─── gates ──→ TASK-009, TASK-012

011 (plugin scaffold + vessel key)
 └→ 010 (device registration + revocation)
     └→ 012 (room join endpoint)

008 (QR scanner + unpair)     ← independent, parallel with Phase 1
 └→ 009 (keypair + registration)
     ├── needs 010 (registration endpoint must exist)
     └→ 013 (managed connection)
         └── needs 012 (room join endpoint must exist)

014 (voice agent migration)
 └── needs 012 (JWT metadata format must be defined)
 └── can parallel with 013
```

- **Epic 9 (Connectivity):** TASK-013 reuses the TCP-race URL resolution from 09-connectivity/008+018. If UrlResolver is not yet field-verified, TASK-013 falls back to simple sequential resolution (try LAN with 2s timeout, then Tailscale).
- **OpenClaw Plugin SDK:** Phase 1 tasks depend on the OpenClaw plugin API — verified by Spike A. Fallback: standalone HTTP server if plugin API is insufficient.
- **Epic 27 (E2E Encryption):** Depends on Epic 7. Ed25519 keypairs from TASK-009 feed into X25519 key agreement for content encryption.

## Execution Plan

```
Week 0 (Pre-work):
  [Spike A: Plugin API Verification] ── CRITICAL GATE
  [Spike B: Crypto Interop Test]     ── CRITICAL GATE (parallel with A)

Week 1-2 (Phase 1 + Phase 2 in parallel):
  LANE A (Hub Plugin):           011 → 010 → 012
  LANE B (Mobile Client):       008, then 009 (blocked on Spike B + 008)
  Integration tests:            009 + 010 (registration roundtrip)

Week 3 (Phase 3 + Phase 4 in parallel):
  013 (managed connection)       ── blocked on 009 + 012
  014 (voice agent migration)    ── blocked on 012, parallel with 013

Critical path: Spike A → 011 → 010 → 012 → 013 (full E2E flow)
```

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| OpenClaw plugin API doesn't match assumptions | Medium | Critical — redesign Phase 1 | Spike A with go/no-go + fallback to standalone server |
| Ed25519 cross-platform signature incompatibility | Medium | Critical — blocks all auth | Spike B with fixture-based interop tests |
| Hub clock skew >120s from mobile device | Medium | High — all auth fails | Server returns timestamp; client computes offset |
| Self-hosted Hub behind self-signed HTTPS cert | High | Medium — cert validation fails on mobile | Document as known limitation; cert pinning in v2 |
| FlutterSecureStorage data loss on OS upgrade | Low | High — user must re-pair | Blank-slate detection handles gracefully |
| Epic 9 UrlResolver not field-verified | Low | Low — simple sequential fallback | TASK-013 has fallback path |

## Not In Scope

Explicitly deferred (do not add during implementation):

- **Key rotation** — mentioned in spec as future work
- **Multi-Hub federation** — single Hub per app for MVP
- **Biometric authentication** (Face ID/Touch ID for key access) — nice-to-have, not MVP
- **NFC tap-to-pair** — future alternative to QR
- **Hub-to-Hub device migration** — not a use case for self-hosted
- **Voice fingerprinting integration** (Epic 6) — separate identity layer
- **Rate limiting on registration** — add if abuse is observed (not expected for self-hosted)
- **Relay session key migration** — relay continues using `session/bind`; JWT metadata is voice-agent only

## Closed / Superseded Tasks

Tasks 001–007 from the original EPIC.md are retired:
- **001–003** (protocol spec, token endpoint, LiveKit integration) were completed as part of the early prototype and are marked ✅ in SUMMARY.md.
- **004–007** (vessel key spec, blank slate UI, camera handshake, bridge skill) were abstract placeholders that never had task files. Their scope is now covered by the concrete tasks 008–014.

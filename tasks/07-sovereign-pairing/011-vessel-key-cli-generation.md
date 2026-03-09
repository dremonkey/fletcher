# TASK-011: OpenClaw Plugin Scaffold + Vessel Key Generation

## Status
- **Status:** Open
- **Priority:** High
- **Owner:** Unassigned
- **Created:** 2026-03-08
- **Phase:** Phase 1 — Hub Plugin
- **Depends On:** None (first in chain)

## Spec Reference
- [Vessel Key Pairing Spec](../../docs/specs/vessel-key-pairing-spec.md) — payload format, token lifecycle
- [Phase 1 MVP Spec §1.4](../../docs/specs/phase-1-mvp-spec.md) — Hub Implementation Checklist

## Problem

The Hub needs a way to initiate pairing with mobile devices. This requires an OpenClaw plugin (`openclaw-plugin-fletcher`) that manages device lifecycle — starting with generating Vessel Keys (QR codes) for scanning. No plugin package exists yet.

## Solution

### Part 1: Plugin Scaffold

Create the `openclaw-plugin-fletcher` package with:

1. **Plugin manifest** — name, version, lifecycle hooks (`onLoad`, `onUnload`)
2. **Token store** — in-memory map of pairing tokens with expiry and single-use flag (SQLite for durability later)
3. **Device store** — persistent storage of registered device identities (deviceId, publicKey, hubId, createdAt)
4. **Plugin lifecycle** — initialize stores on load, clean up on unload

### Part 2: Vessel Key CLI Command

Register `vessel-key generate` via the OpenClaw plugin CLI API:

1. Generate a pairing token with 15-minute expiry
2. Construct Vessel Key JSON payload (version, hubIdentity, network, auth, services)
3. Render the JSON as a QR code in the terminal
4. Also print the raw JSON for manual copy/paste fallback
5. Store the pairing token for later validation by TASK-010

### Vessel Key Payload
```json
{
  "version": "1.0",
  "hubIdentity": { "name": "<hub_name>", "deviceId": "<hub_id>" },
  "network": { "gatewayUrl": "https://...", "tailscaleIp": "100.64.x.x" },
  "auth": { "pairingToken": "pair_<random>", "tokenExpiry": <unix_ts>, "hubPublicKey": "ed25519:..." },
  "services": { "livekit": { "url": "wss://..." } }
}
```

### Dependencies
- `qrcode-terminal` — QR rendering for CLI
- `nanoid` or `crypto.randomBytes` — Token generation

## Acceptance Criteria
- [ ] `openclaw-plugin-fletcher` package exists with valid plugin manifest
- [ ] Token store supports create, lookup, and revoke operations
- [ ] Device store supports create and lookup by deviceId
- [ ] `vessel-key generate` command is registered via plugin CLI API
- [ ] `--name` flag sets the Hub identity name
- [ ] QR code renders in terminal output
- [ ] Raw JSON is also printed below the QR code
- [ ] Pairing token has 15-minute expiry
- [ ] Token is stored for later validation by TASK-010
- [ ] Gateway URL and LiveKit URL are sourced from Hub config

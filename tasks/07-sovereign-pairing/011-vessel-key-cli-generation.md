# TASK-011: OpenClaw Plugin Scaffold + Vessel Key Generation

## Status
- **Status:** Open
- **Priority:** High
- **Owner:** Unassigned
- **Created:** 2026-03-08
- **Updated:** 2026-03-16 (plan review refinements)
- **Phase:** Phase 1 — Hub Plugin
- **Depends On:** Spike A (OpenClaw plugin API verification)

## Spec Reference
- [Vessel Key Pairing Spec](../../docs/specs/vessel-key-pairing-spec.md) — payload format, token lifecycle
- [Phase 1 MVP Spec §1.4](../../docs/specs/phase-1-mvp-spec.md) — Hub Implementation Checklist

## Problem

The Hub needs a way to initiate pairing with mobile devices. This requires an OpenClaw plugin (`openclaw-plugin-fletcher`) that manages device lifecycle — starting with generating Vessel Keys (QR codes) for scanning. No plugin package exists yet.

## Solution

### Part 1: Plugin Scaffold

Create `packages/openclaw-plugin-fletcher/` with:

1. **Plugin manifest** — name, version, lifecycle hooks (`onLoad`, `onUnload`)
2. **Token store (SQLite)** — pairing tokens with expiry and single-use flag. SQLite with WAL mode for durability and crash safety. No in-memory fallback — a Hub restart during the 15-min pairing window must not lose the token.
3. **Device store (SQLite)** — registered device identities (deviceId, publicKey, hubId, createdAt, isOwner, revokedAt). Queryable by deviceId for signature verification (TASK-012).
4. **Plugin lifecycle** — initialize SQLite on load, run migrations, clean up on unload

### Part 2: Vessel Key CLI Command

Register `vessel-key generate` via the OpenClaw plugin CLI API:

1. Generate a pairing token (`pair_<32-hex>`) with 15-minute expiry
2. Construct Vessel Key JSON payload (version, hubIdentity, network, auth, services)
3. Render the JSON as a QR code in the terminal
4. Also print the raw JSON for manual copy/paste fallback
5. Store the pairing token in SQLite for later validation by TASK-010

### Part 3: Admin CLI Commands

Register additional admin commands:

- `vessel-key list-devices` — show all registered devices with last-auth timestamp and revocation status
- `vessel-key list-tokens` — show active (non-expired, non-revoked) pairing tokens (for debugging)
- `vessel-key cleanup` — remove expired tokens and orphaned devices (no successful auth within 24h of registration)

### Vessel Key Payload
```json
{
  "version": "1.0",
  "hubIdentity": { "name": "<hub_name>", "deviceId": "<hub_id>" },
  "network": { "gatewayUrl": "https://...", "tailscaleIp": "100.64.x.x" },
  "auth": { "pairingToken": "pair_<random>", "tokenExpiry": 1709851500000, "hubPublicKey": "ed25519:..." },
  "services": { "livekit": { "url": "wss://..." } }
}
```

**Note:** `tokenExpiry` is Unix milliseconds (not seconds). This aligns with JS `Date.now()` and Dart `DateTime.now().millisecondsSinceEpoch`.

### Plugin Configuration

The plugin exposes these configuration values (from Hub environment or config file):
- `agentName` — Display name for the AI in the chat UI (default: `"Glitch"`)
- `gatewayUrl` — Hub's HTTPS gateway URL (sourced from Hub config)
- `tailscaleIp` — Hub's Tailscale IP (optional)
- `livekitUrl` — LiveKit server URL (sourced from Hub config)

### QR Payload Size

The Vessel Key JSON (minified) should stay under 400 bytes to ensure reliable scanning in low-light conditions. At 400+ bytes, the QR code requires version 12+ which is harder to scan reliably. If the payload exceeds 400 bytes:
- Make `hubPublicKey` optional (it is not used in Phase 1 — no Hub signature verification yet)
- Strip `metadata` fields from the QR payload (can be fetched post-registration)

### Dependencies
- `qrcode-terminal` — QR rendering for CLI
- `crypto.randomBytes` — Token generation
- Use OpenClaw's persistence API if available (verified by Spike A); otherwise `better-sqlite3` with WAL mode

## Implementation Notes

- Plugin lives at `packages/openclaw-plugin-fletcher/` in the Fletcher monorepo (workspace auto-discovery via `packages/*` glob)
- **Pre-req:** Spike A must verify that OpenClaw's plugin API supports `registerHttpRoute()`, `registerCommand()`, and data persistence. If the API differs from assumptions, this task needs redesign.
- Logging: Use `pino` with child loggers per component (`pairing`, `device-store`, `token-store`) per CLAUDE.md standards
- SQLite schema should include a `schema_version` table for future migrations
- Token store should use atomic compare-and-swap for revocation (prevents concurrent registration race condition)

## Acceptance Criteria
- [ ] `openclaw-plugin-fletcher` package exists at `packages/openclaw-plugin-fletcher/` with valid plugin manifest
- [ ] SQLite database created on plugin load with token and device tables
- [ ] Token store supports create, lookup, and atomic revoke operations
- [ ] Device store supports create, lookup by deviceId, and soft-delete (revocation)
- [ ] `vessel-key generate` command is registered via plugin CLI API
- [ ] `--name` flag sets the Hub identity name
- [ ] QR code renders in terminal output
- [ ] Raw JSON is also printed below the QR code
- [ ] Pairing token has 15-minute expiry (in milliseconds)
- [ ] Token is stored in SQLite for later validation by TASK-010
- [ ] Gateway URL and LiveKit URL are sourced from Hub config
- [ ] Vessel Key JSON (minified) is under 400 bytes (or `hubPublicKey` is omitted to fit)
- [ ] `agentName` is configurable via plugin config (default: `"Glitch"`)
- [ ] All stores survive Hub restart (SQLite persistence verified)

### P2 — Admin CLI (nice to have, not gating for pairing flow)
- [ ] `vessel-key list-devices` shows registered devices
- [ ] `vessel-key list-tokens` shows active pairing tokens
- [ ] `vessel-key cleanup` removes expired tokens

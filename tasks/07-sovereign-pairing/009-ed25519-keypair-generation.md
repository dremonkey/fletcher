# TASK-009: Ed25519 Keypair Generation and Device Registration

## Status
- **Status:** Open
- **Priority:** High
- **Owner:** Unassigned
- **Created:** 2026-03-08
- **Updated:** 2026-03-16 (plan review refinements)
- **Phase:** Phase 2 — Mobile Client
- **Depends On:** TASK-008 (QR scanner), TASK-010 (registration endpoint), Spike B (crypto interop verified)

## Spec Reference
- [Phase 1 MVP Spec §1.3](../../docs/specs/phase-1-mvp-spec.md) — Steps 4-6

## Problem

After scanning a Vessel Key, the mobile app needs to generate a device identity (Ed25519 keypair), register with the Hub, and securely store credentials.

## Solution

### Step 1: Generate Ed25519 Keypair
```dart
import 'package:cryptography/cryptography.dart';
final algorithm = Ed25519();
final keyPair = await algorithm.newKeyPair();
```

The `cryptography` package must produce signatures verifiable by `@noble/ed25519` on the Hub side. This is verified by Spike B before implementation begins.

### Step 2: Register Device with Hub
POST to `${vesselKey.network.gatewayUrl}/fletcher/devices/register` with:
- `publicKey` (base64-encoded Ed25519 public key)
- `deviceModel`, `os`, `appVersion`
- Authorization: Bearer token (pairing token from Vessel Key, single-use)

### Step 3: Process Registration Response
The Hub returns `{ "deviceId": "device_...", "agentName": "Glitch", "serverTime": 1709850600000 }`.

Compute and store the clock offset: `clockOffset = serverTime - DateTime.now().millisecondsSinceEpoch`. This offset is used by TASK-013's HubAuthService to align timestamps for signed requests, making the system resilient to clock skew on self-hosted Hubs.

### Step 4: Secure Credential Storage
Store in `FlutterSecureStorage` (iOS Keychain / Android Keystore):
- `device_id` — Hub-assigned deviceId (e.g., `device_f1e2d3c4b5a69788` — 16 hex chars)
- `device_private_key` — Ed25519 private key seed (base64)
- `agent_name` — returned by Hub (display name for the AI in the chat UI)
- `hub_gateway_url`, `hub_tailscale_ip`, `hub_public_key`, `livekit_url`
- `clock_offset` — milliseconds offset between local clock and Hub server time

**Important: Hub-assigned `deviceId` becomes the participant identity.** After pairing, `SessionStorage.getDeviceId()` must check `FlutterSecureStorage` for a Hub-assigned `device_id` first, falling back to the hardware-derived ID (`device-<ANDROID_ID>`) only when unpaired. This ensures the participant identity in LiveKit matches the identity the Hub issued the JWT for.

### Dependencies
- `cryptography: ^2.7.0` — Pure Dart Ed25519
- `flutter_secure_storage: ^9.0.0` — iOS Keychain + Android Keystore

## Implementation Notes

### Credential Storage Separation
Do NOT store Hub credentials in `SessionStorage` (which uses SharedPreferences). Use a separate `CredentialStorage` wrapper around FlutterSecureStorage. This keeps the security boundary clear:
- **SharedPreferences** (SessionStorage): Non-sensitive preferences — room name, text-only mode toggle, UI state
- **FlutterSecureStorage** (CredentialStorage): Secrets — private key, Hub URL, deviceId, clock offset

### FlutterSecureStorage Configuration
- **Android:** Set `resetOnError: false` to prevent silent data deletion on decryption failure (which would cause unexpected unpair after OS upgrades). Handle errors explicitly instead.
- **iOS:** Use `KeychainAccessibility.first_unlock` (accessible after first device unlock). Do NOT use `when_unlocked_this_device_only` — it would prevent the app from loading credentials during background reconnection.

### Keypair Lifecycle on Failure
On registration failure (network error, 401, etc.), do NOT persist the keypair. Generate a fresh keypair on retry. This avoids orphaned keys in secure storage.

### Error Handling
- **Network timeout:** Show "Cannot reach your Hub. Check network connection." with retry button.
- **401 (token invalid/expired):** Show "Pairing code expired or already used. Generate a new one on your Hub."
- **400 (bad payload):** Show "Registration failed. App version may be incompatible." with error detail.
- **Storage write failure:** Show "Cannot save credentials. Device storage may be full." This is a critical failure — do not proceed to main screen.

### File Organization
```
apps/mobile/lib/
  services/
    credential_storage.dart   # FlutterSecureStorage wrapper (secrets only)
    pairing_service.dart      # isPaired(), registerDevice(), unpair()
```

## Acceptance Criteria
- [ ] Ed25519 keypair is generated on device
- [ ] Device registers with Hub via POST endpoint
- [ ] Registration uses pairing token as Bearer auth
- [ ] Hub returns a `deviceId`, `agentName`, and `serverTime` on success (201)
- [ ] Clock offset is computed and stored
- [ ] All credentials stored in FlutterSecureStorage (not SharedPreferences)
- [ ] Private key is stored encrypted (hardware-backed on Android)
- [ ] `FlutterSecureStorage` uses `resetOnError: false`
- [ ] `SessionStorage.getDeviceId()` checks CredentialStorage for Hub-assigned ID first
- [ ] Registration failure shows clear error to user (distinct messages for 401, 400, timeout)
- [ ] Storage write failure is handled (does not silently proceed)
- [ ] Transition to main conversation screen after successful pairing
- [ ] Cross-platform signature roundtrip verified (Dart sign → TypeScript verify) — covered by Spike B

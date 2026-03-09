# TASK-009: Ed25519 Keypair Generation and Device Registration

## Status
- **Status:** Open
- **Priority:** High
- **Owner:** Unassigned
- **Created:** 2026-03-08
- **Phase:** Phase 2 — Mobile Client
- **Depends On:** TASK-008 (QR scanner), TASK-010 (registration endpoint, provided by `openclaw-plugin-fletcher`)

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

### Step 2: Register Device with Hub
POST to `${vesselKey.network.gatewayUrl}/fletcher/devices/register` with:
- `publicKey` (base64-encoded Ed25519 public key)
- `deviceModel`, `os`, `appVersion`
- Authorization: Bearer token (pairing token from Vessel Key, single-use)

### Step 3: Secure Credential Storage
Store in `FlutterSecureStorage` (iOS Keychain / Android Keystore):
- `device_id` — returned by Hub
- `device_private_key` — Ed25519 private key (base64)
- `hub_gateway_url`, `hub_tailscale_ip`, `hub_public_key`, `livekit_url`

### Dependencies
- `cryptography: ^2.7.0` — Pure Dart Ed25519
- `flutter_secure_storage: ^9.0.0` — iOS Keychain + Android Keystore

## Acceptance Criteria
- [ ] Ed25519 keypair is generated on device
- [ ] Device registers with Hub via POST endpoint
- [ ] Registration uses pairing token as Bearer auth
- [ ] Hub returns a `deviceId` on success (201)
- [ ] All credentials stored in FlutterSecureStorage (not SharedPreferences)
- [ ] Private key is stored encrypted (hardware-backed on Android)
- [ ] Registration failure shows clear error to user
- [ ] Transition to main conversation screen after successful pairing

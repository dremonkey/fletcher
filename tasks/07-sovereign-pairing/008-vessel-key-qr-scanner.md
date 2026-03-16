# TASK-008: QR Code Scanner for Vessel Key Pairing

## Status
- **Status:** Open
- **Priority:** High
- **Owner:** Unassigned
- **Created:** 2026-03-08
- **Updated:** 2026-03-16 (plan review refinements)
- **Phase:** Phase 2 — Mobile Client
- **Depends On:** None (can be built in parallel with Phase 1 Hub tasks)

## Spec Reference
- [Phase 1 MVP Spec §1.3](../../docs/specs/phase-1-mvp-spec.md) — Mobile Client Flow (Steps 1-3)

## Problem

The Fletcher mobile app has no way to pair with a Hub without manual URL entry. Users must type long URLs and tokens, which is error-prone and violates the sovereign pairing philosophy.

## Solution

Implement a QR code scanning flow on the Flutter mobile app:

### Step 1: Blank Slate Detection
On app launch, check for existing pairing credentials in `FlutterSecureStorage` (specifically: `device_id` and `hub_gateway_url`). If unpaired, show the Pairing Screen.

### Step 2: QR Scanner Screen
- Full-screen camera view using `mobile_scanner` package
- On barcode detection, extract the raw JSON value
- Parse as Vessel Key JSON, validate version (`1.0`) and token expiry (15-min window, in milliseconds)
- Show error states for expired, malformed, or unsupported keys

### Step 3: Manual Entry Fallback
This is a **first-class path**, not an afterthought:
- Text field for pasting Vessel Key JSON (accessible via button below QR scanner)
- Same validation as QR path (version, expiry, required fields)
- Essential for development iteration and for users whose camera doesn't work

### Step 4: Unpair / Factory Reset
Settings screen includes an "Unpair" button:
1. Confirmation dialog ("This will disconnect from your Hub. You'll need to scan a new pairing code.")
2. Clear all `FlutterSecureStorage` entries (device_id, device_private_key, hub_gateway_url, etc.)
3. Navigate back to blank slate / pairing screen

This is essential for:
- Development iteration (re-testing the pairing flow)
- Switching to a different Hub
- Troubleshooting corrupted credentials

### Dependencies
- `mobile_scanner: ^5.0.0` — QR code detection (iOS + Android)

## Implementation Notes

- The pairing screen should be the app's initial route when unpaired
- Camera permission handling: prompt on first scan attempt, show instructions if denied
- Store the `VesselKey` model as a Dart data class with `fromJson` factory
- Validate all required fields: `version`, `hubIdentity.name`, `network.gatewayUrl`, `auth.pairingToken`, `auth.tokenExpiry`, `services.livekit.url`
- Token expiry validation: compare `auth.tokenExpiry` (Unix milliseconds) against `DateTime.now().millisecondsSinceEpoch`
- On successful QR parse, pass the VesselKey to TASK-009's registration flow

### File Organization
```
apps/mobile/lib/
  models/
    vessel_key.dart           # VesselKey data class + fromJson + validation
  screens/
    pairing_screen.dart       # QR scanner + manual entry UI
  widgets/
    qr_scanner_view.dart      # Extracted camera widget (reusable)
```

## Acceptance Criteria
- [ ] App detects unpaired state on launch and shows pairing screen
- [ ] QR scanner opens with camera preview
- [ ] Scanning a valid Vessel Key QR extracts the JSON payload
- [ ] Vessel Key version is validated (reject != "1.0")
- [ ] Expired tokens (>15 min) are rejected with clear error message
- [ ] Malformed JSON shows error state
- [ ] Missing required fields show specific error (which field is missing)
- [ ] Manual entry fallback is accessible and works identically to QR path
- [ ] Camera permission is requested gracefully (instructions if denied)
- [ ] "Unpair" button in settings clears all secure storage and returns to pairing screen
- [ ] Unpair shows confirmation dialog before proceeding
- [ ] VesselKey model has `fromJson` factory with validation
- [ ] Token expiry comparison uses `DateTime.now().millisecondsSinceEpoch` (NOT `/ 1000`) against `auth.tokenExpiry` (milliseconds)
- [ ] `network.gatewayUrl` is required; `network.tailscaleIp` is optional (fallback degrades gracefully)
- [ ] iOS `NSCameraUsageDescription` in Info.plist is set to appropriate string

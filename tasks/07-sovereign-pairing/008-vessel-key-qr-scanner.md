# TASK-008: QR Code Scanner for Vessel Key Pairing

## Status
- **Status:** Open
- **Priority:** High
- **Owner:** Unassigned
- **Created:** 2026-03-08
- **Phase:** Phase 2 — Mobile Client
- **Depends On:** None (can be built in parallel with Phase 1 Hub tasks)

## Spec Reference
- [Phase 1 MVP Spec §1.3](../../docs/specs/phase-1-mvp-spec.md) — Mobile Client Flow (Steps 1-3)

## Problem

The Fletcher mobile app has no way to pair with a Hub without manual URL entry. Users must type long URLs and tokens, which is error-prone and violates the sovereign pairing philosophy.

## Solution

Implement a QR code scanning flow on the Flutter mobile app:

### Step 1: Blank Slate Detection
On app launch, check for existing pairing credentials in `FlutterSecureStorage`. If unpaired, show the Pairing Screen.

### Step 2: QR Scanner Screen
- Full-screen camera view using `mobile_scanner` package
- On barcode detection, extract the raw JSON value
- Parse as Vessel Key JSON, validate version (`1.0`) and token expiry (15-min window)
- Show error states for expired, malformed, or unsupported keys

### Dependencies
- `mobile_scanner: ^5.0.0` — QR code detection (iOS + Android)

## Implementation Notes

- The pairing screen should be the app's initial route when unpaired
- Include a manual entry fallback (text field for pasting Vessel Key JSON)
- Camera permission handling: prompt on first scan attempt, show instructions if denied

## Acceptance Criteria
- [ ] App detects unpaired state on launch and shows pairing screen
- [ ] QR scanner opens with camera preview
- [ ] Scanning a valid Vessel Key QR extracts the JSON payload
- [ ] Vessel Key version is validated (reject != "1.0")
- [ ] Expired tokens (>15 min) are rejected with clear error message
- [ ] Malformed JSON shows error state
- [ ] Manual entry fallback is available
- [ ] Camera permission is requested gracefully

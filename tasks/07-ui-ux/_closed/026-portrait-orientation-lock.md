# TASK-026: Lock App to Portrait Orientation

## Status
- **Status:** Complete
- **Priority:** Low
- **Created:** 2026-03-07
- **Closed:** 2026-03-08

## Bug Reference
- [BUG-011](../../docs/field-tests/20260307-buglog.md) — Landscape orientation enabled; requires locking to Portrait mode

## Problem

The Fletcher mobile app allows landscape orientation, which is not designed for and creates a broken layout experience. The app should be locked to portrait mode.

## Solution

1. **Android:** Set `android:screenOrientation="portrait"` in `AndroidManifest.xml` on the main `<activity>`.
2. **iOS:** Set `UISupportedInterfaceOrientations` to portrait only in `Info.plist`.
3. **Flutter:** Call `SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp])` in `main()` as a belt-and-suspenders approach.

## Acceptance Criteria
- [x] App locked to portrait on Android
- [x] App locked to portrait on iOS
- [x] Rotating device does not change orientation

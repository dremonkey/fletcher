# TASK-028: Rename App for Field Testing (Two-Word Dash Name)

## Status
- **Status:** Open
- **Priority:** Low
- **Owner:** Unassigned
- **Created:** 2026-03-07

## Bug Reference
- [BUG-018](../../docs/field-tests/20260307-buglog.md) — Rename the mobile app to a two-word "Dash" variant

## Problem

The app's display name is generic. For field testing, a distinctive two-word hyphenated name is desired (e.g., "Fletcher-Orphan-Jewel", "Fletcher-Jade-Basket").

## Solution

1. Choose a definitive two-word name
2. Update `android:label` in `AndroidManifest.xml`
3. Update `CFBundleName` and `CFBundleDisplayName` in `Info.plist`
4. Optionally update `pubspec.yaml` description

## Acceptance Criteria
- [ ] App displays the chosen two-word name on Android home screen
- [ ] App displays the chosen two-word name on iOS home screen

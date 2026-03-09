# TASK-002: Implement Long-Press Gesture Detector on Mic Button

## Status
- **Status:** Complete
- **Priority:** High
- **Owner:** Unassigned
- **Created:** 2026-03-08

## Epic
- [Epic 17: Text Input Mode](./EPIC.md)

## Problem
The Mic button (Amber Orb) currently handles tap gestures for start/stop recording. It needs to also detect long-press to trigger the text-input mode transition.

## Solution
1. Wrap the Mic button in a `GestureDetector` with `onLongPress` callback (or use `onLongPressStart` for immediate feedback)
2. Long-press should dispatch `ToggleInputMode` to ConversationBloc
3. Ensure long-press does not conflict with existing tap behavior (tap = record toggle, long-press = mode switch)
4. Consider a ~500ms long-press duration threshold

## Acceptance Criteria
- [x] Long-press on Mic button is detected and dispatches `ToggleInputMode`
- [x] Tap behavior (start/stop recording) is preserved and unaffected
- [x] Long-press duration threshold feels natural (~400-600ms)

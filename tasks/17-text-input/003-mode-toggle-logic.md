# TASK-003: Add Mode Toggle Logic (Voice-First ↔ Text-Input)

## Status
- **Status:** Open
- **Priority:** High
- **Owner:** Unassigned
- **Created:** 2026-03-08

## Epic
- [Epic 17: Text Input Mode](./EPIC.md)

## Problem
The app needs clean toggle logic to switch between voice-first and text-input modes, ensuring proper cleanup on each transition (e.g., stopping recording when entering text mode, dismissing keyboard when returning to voice mode).

## Solution
1. In ConversationBloc's `ToggleInputMode` handler:
   - If switching to `textInput`: stop any active recording, update state
   - If switching to `voiceFirst`: clear text field, dismiss keyboard, update state
2. Ensure mode transitions are idempotent (toggling to current mode is a no-op)
3. Consider edge cases: what happens if a recording is in progress during long-press?

## Acceptance Criteria
- [ ] Toggling to text-input mode stops active recording if in progress
- [ ] Toggling to voice-first mode clears text input state
- [ ] Mode transitions are idempotent
- [ ] Edge cases (mid-recording toggle, mid-typing toggle) handled gracefully

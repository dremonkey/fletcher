# TASK-016: Ensure Keyboard Dismisses and Text Clears on Revert to Voice-First

## Status
- **Status:** Complete
- **Priority:** Low
- **Owner:** Unassigned
- **Created:** 2026-03-08

## Epic
- [Epic 17: Text Input Mode](./EPIC.md)

## Problem
When the user long-presses to revert from text-input mode back to voice-first mode, the keyboard should dismiss, any unsent text should be cleared, and focus should return to the voice controls.

## Solution
1. On mode revert, call `focusNode.unfocus()` to dismiss the keyboard
2. Clear the `TextEditingController` text
3. Time these actions to happen at the start of the reverse animation
4. Consider whether to warn if there's unsent text (probably not — keep it frictionless)

## Acceptance Criteria
- [x] Keyboard dismisses when reverting to voice-first mode
- [x] Text field content is cleared on revert
- [x] No orphaned focus or lingering keyboard after mode switch

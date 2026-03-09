# TASK-015: Ensure Text Field Auto-Focuses When Entering Text-Input Mode

## Status
- **Status:** Complete
- **Priority:** Low
- **Owner:** Unassigned
- **Created:** 2026-03-08

## Epic
- [Epic 17: Text Input Mode](./EPIC.md)

## Problem
When the user long-presses to enter text-input mode, the text field should automatically receive focus and bring up the keyboard, so the user can start typing immediately without an extra tap.

## Solution
1. Create a `FocusNode` for the text field
2. After the mode transition animation completes, call `focusNode.requestFocus()`
3. Time the focus request to fire after the expand animation finishes (use animation status listener or `Future.delayed`)
4. Ensure the keyboard appears automatically on focus

## Acceptance Criteria
- [x] Text field auto-focuses when entering text-input mode
- [x] Keyboard appears automatically (no extra tap required)
- [x] Focus request is timed after animation completes (not during)

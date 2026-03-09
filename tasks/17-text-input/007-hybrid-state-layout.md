# TASK-007: Handle Layout Reflow and Positioning for Hybrid State

## Status
- **Status:** Open
- **Priority:** Medium
- **Owner:** Unassigned
- **Created:** 2026-03-08

## Epic
- [Epic 17: Text Input Mode](./EPIC.md)

## Problem
The hybrid state (text field + Mic button side by side) requires proper layout handling so the toolbar doesn't overflow, clip, or look broken at different screen sizes.

## Solution
1. Use a `Row` or `Stack` layout that accommodates both the text field and the repositioned Mic button
2. Text field should use `Expanded` or `Flexible` to fill available horizontal space
3. Mic button should have a fixed size on the right
4. Test on multiple screen widths to ensure no overflow
5. Ensure the keyboard inset doesn't cause layout issues (use `MediaQuery.of(context).viewInsets`)

## Acceptance Criteria
- [ ] Hybrid layout renders correctly on various screen widths
- [ ] No overflow or clipping in text-input mode
- [ ] Keyboard appearance doesn't break layout
- [ ] Layout transitions cleanly between voice-first and text-input states

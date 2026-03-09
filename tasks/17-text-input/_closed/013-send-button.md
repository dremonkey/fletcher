# TASK-013: Add Send Button (Visible in Text-Input Mode)

## Status
- **Status:** Complete
- **Priority:** Medium
- **Owner:** Unassigned
- **Created:** 2026-03-08

## Epic
- [Epic 17: Text Input Mode](./EPIC.md)

## Problem
A visible send button provides a clear affordance for submitting text messages, complementing the Enter-key shortcut.

## Solution
1. Add a send icon button (e.g., `Icons.send` or arrow-up icon) adjacent to the text field
2. Style with TUI Brutalist design: `AppColors.amber` icon on dark background
3. Button dispatches `SendTextMessage` with current text field content
4. Disable or visually dim the button when text field is empty
5. Position: between the text field and the Mic button (right side)

## Acceptance Criteria
- [x] Send button visible in text-input mode, hidden in voice-first mode
- [x] Tapping send button submits the message
- [x] Button is disabled/dimmed when text field is empty
- [x] Styled consistently with TUI Brutalist design system

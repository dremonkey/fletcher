# TASK-008: Add TextField Widget with TUI Brutalist Styling

## Status
- **Status:** Open
- **Priority:** High
- **Owner:** Unassigned
- **Created:** 2026-03-08

## Epic
- [Epic 17: Text Input Mode](./EPIC.md)

## Problem
The text input field needs to follow the TUI Brutalist design system established in Epic 11, using `AppColors`, `AppTypography`, and fitting visually with the existing UI.

## Solution
1. Create a styled `TextField` (or `TextFormField`) widget
2. Apply TUI Brutalist styling:
   - Background: `AppColors.surface` or similar dark tone
   - Text style: `AppTypography.body` or monospaced variant
   - Border: sharp corners (no rounded), possibly `AppColors.amber` accent border
   - Cursor color: `AppColors.amber`
3. Add placeholder text (e.g., "Type a message...")
4. Include a `TextEditingController` for managing input state

## Acceptance Criteria
- [ ] TextField uses TUI Brutalist design system (AppColors, AppTypography)
- [ ] Sharp corners, monospaced font, amber accents
- [ ] Placeholder text visible when empty
- [ ] `TextEditingController` properly initialized and disposed

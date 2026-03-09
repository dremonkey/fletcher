# TASK-012: Add Enter-Key Submission Handler

## Status
- **Status:** Open
- **Priority:** Medium
- **Owner:** Unassigned
- **Created:** 2026-03-08

## Epic
- [Epic 17: Text Input Mode](./EPIC.md)

## Problem
Users expect to submit text messages by pressing Enter on the soft keyboard (or hardware keyboard). The TextField needs to handle this input action.

## Solution
1. Set `textInputAction: TextInputAction.send` on the TextField
2. Use `onSubmitted` callback to dispatch `SendTextMessage` to ConversationBloc
3. Alternatively, use `onEditingComplete` or a `RawKeyboardListener` for Enter key detection
4. Ensure Shift+Enter inserts a newline (for multi-line messages) if desired, or keep it single-line

## Acceptance Criteria
- [ ] Pressing Enter/Send on keyboard submits the message
- [ ] Submission triggers the same flow as the send button
- [ ] Keyboard action button shows "Send" (not "Done" or "Return")

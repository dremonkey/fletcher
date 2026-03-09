# TASK-009: Wire TextField to ConversationBloc.sendTextMessage()

## Status
- **Status:** Complete
- **Priority:** High
- **Owner:** Unassigned
- **Created:** 2026-03-08

## Epic
- [Epic 17: Text Input Mode](./EPIC.md)

## Problem
When the user submits text (via Enter key or send button), the message needs to flow through the ConversationBloc into the voice pipeline's session, so the agent sees it alongside spoken messages.

## Solution
1. Add a `SendTextMessage` event to ConversationBloc with a `text` payload
2. In the event handler, send the text through the appropriate channel (see task 010)
3. Add the user's text message to the local transcript state immediately (optimistic update)
4. Clear the `TextEditingController` after successful submission
5. Handle empty/whitespace-only submissions (no-op)

## Acceptance Criteria
- [x] `SendTextMessage` event added to ConversationBloc
- [x] User's typed message appears in transcript immediately after submission
- [x] Text field clears after successful send
- [x] Empty/whitespace-only messages are rejected (no-op)

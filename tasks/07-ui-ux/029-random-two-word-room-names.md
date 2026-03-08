# TASK-029: Random "Two-Word-Dash" Room Name Generation

## Status
- **Status:** Open
- **Priority:** Low
- **Owner:** Unassigned
- **Created:** 2026-03-07

## Bug Reference
- [BUG-019](../../docs/field-tests/20260307-buglog.md) — Random "Two-Word-Dash" Room Name Generation

## Problem

Currently rooms use `fletcher-<unix-millis>` format (from Task 021). The tester wants human-readable "two-word-dash" room names (e.g., `orphan-jewel`, `jade-basket`) instead of opaque timestamps.

## Solution

1. Create a `RoomNameGenerator` utility in `apps/mobile/lib/utils/naming.dart`
2. Populate with two distinct word lists (adjectives/nouns or evocative pairs)
3. Generate names as `word1-word2` (hyphenated, lowercase)
4. Update the room connection logic to use generated names instead of timestamp-based names
5. Ensure uniqueness is sufficient (collision unlikely for concurrent sessions)

## Acceptance Criteria
- [ ] Room names are human-readable two-word pairs
- [ ] Names are randomly generated at room creation time
- [ ] Collision probability is acceptably low

# TASK-030: Agent Speech Bubbles Too Narrow in Brutalist UI

## Status
- **Status:** Open
- **Priority:** Low
- **Owner:** Unassigned
- **Created:** 2026-03-07

## Bug Reference
- [20260307 buglog, 06:30 entry](../../docs/field-tests/20260307-buglog.md) — Agent's speech bubbles are slightly too narrow in Brutalist UI

## Problem

The agent's chat bubbles in the Brutalist UI are narrower than they should be, making longer messages feel cramped and reducing readability.

## Solution

1. Audit the `ChatTranscript` / message bubble widget for max-width constraints
2. Increase the max-width or adjust padding/margin to use more of the available screen width
3. Ensure the change looks good on both narrow (phone) and wider (tablet) screens

## Acceptance Criteria
- [ ] Agent message bubbles use appropriate width for readability
- [ ] Layout doesn't break on narrow screens
- [ ] Visual consistency with Brutalist design system maintained

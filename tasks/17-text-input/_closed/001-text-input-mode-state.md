# TASK-001: Add TextInputMode State to ConversationBloc

## Status
- **Status:** Complete
- **Priority:** High
- **Owner:** Unassigned
- **Created:** 2026-03-08

## Epic
- [Epic 17: Text Input Mode](./EPIC.md)

## Problem
The ConversationBloc currently only supports voice-first interaction. There is no state to represent whether the user is in voice mode or text-input mode, which is needed to drive the UI transition and message routing.

## Solution
1. Define a `TextInputMode` enum (or similar) with values: `voiceFirst`, `textInput`
2. Add `inputMode` field to ConversationBloc state
3. Add `ToggleInputMode` event to switch between modes
4. Emit updated state when mode toggles, which downstream widgets observe to animate the UI

## Acceptance Criteria
- [x] `TextInputMode` enum exists with `voiceFirst` and `textInput` values
- [x] ConversationBloc state includes `inputMode` field, defaulting to `voiceFirst`
- [x] `ToggleInputMode` event triggers state transition between modes
- [x] Unit tests cover mode toggling

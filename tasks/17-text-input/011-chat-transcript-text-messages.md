# TASK-011: Update ChatTranscript to Render Text-Origin Messages

## Status
- **Status:** Open
- **Priority:** Medium
- **Owner:** Unassigned
- **Created:** 2026-03-08

## Epic
- [Epic 17: Text Input Mode](./EPIC.md)

## Problem
The ChatTranscript widget currently renders messages from the voice pipeline (STT transcripts and agent responses). It needs to also display messages that originated from text input, potentially with a visual distinction.

## Solution
1. Add an `origin` field to the transcript message model (e.g., `voice`, `text`)
2. Text-origin user messages should render in the same transcript list as voice messages
3. Optionally add a subtle visual indicator for text-origin messages (e.g., a small keyboard icon or different text style) — keep it minimal per TUI Brutalist philosophy
4. Agent responses to text messages render identically to voice-triggered responses

## Acceptance Criteria
- [ ] Text-origin messages appear in ChatTranscript alongside voice messages
- [ ] Messages maintain chronological order regardless of origin
- [ ] Optional visual indicator distinguishes text vs voice origin
- [ ] Agent responses render consistently regardless of input origin

# TASK-016: Core TTS Rule Enforcement

## Status
- **Status:** Not started
- **Priority:** High

## Context
TTS engines struggle with markdown symbols (*, #, -, [ ]) and dense formatting. We need to enforce a strictly text-only output for the voice stream.

## Requirements
- Update system prompts to explicitly forbid all markdown characters.
- Implement verbal signposting ("First", "Second", "Finally") instead of bullet points.
- Enforce the use of punctuation (commas, ellipses, dashes) to control TTS breathing and pitch.
- Add phonetic spelling overrides for consistently mispronounced project terms (e.g., Knittt, Toch).

## Acceptance Criteria
- Agent output contains zero markdown symbols.
- Lists are delivered using natural verbal transitions.
- Voice pacing feels deliberate and human-like via punctuation control.

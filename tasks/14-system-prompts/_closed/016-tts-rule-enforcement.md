# TASK-016: Core TTS Rule Enforcement

## Status
- **Status:** Complete
- **Priority:** High

## Context
TTS engines struggle with markdown symbols (*, #, -, [ ]) and dense formatting. We need to enforce a strictly text-only output for the voice stream.

## Requirements
- [x] Update system prompts to explicitly forbid all markdown characters.
- [x] Implement verbal signposting ("First", "Second", "Finally") instead of bullet points.
- [x] Enforce the use of punctuation (commas, ellipses, dashes) to control TTS breathing and pitch.
- [x] Add phonetic spelling overrides for consistently mispronounced project terms (e.g., Knittt, Toch).

## Acceptance Criteria
- [x] Agent output contains zero markdown symbols.
- [x] Lists are delivered using natural verbal transitions.
- [x] Voice pacing feels deliberate and human-like via punctuation control.

## Implementation Notes
- Rules added to `VOICE_BOOTSTRAP_BODY` in `apps/voice-agent/src/bootstrap.ts`.
- The bootstrap message is injected as a synthetic user message at session start
  via `session.generateReply({ userInput: bootstrapMsg })`, so it flows through
  the full LLM pipeline and is treated as session-level instructions.
- E2E test rooms (`e2e-*`) keep their own shorter bootstrap and are not affected.
- Coverage: `apps/voice-agent/src/bootstrap.spec.ts` (12 tests).

# TASK-023: Artifact–Message Association (Inline Chronological Anchoring)

## Status
- **Status:** Open
- **Priority:** Medium
- **Depends on:** 018 (Artifact System Redesign)
- **Owner:** Unassigned
- **Created:** 2026-03-07

## Bug Reference
- **BUG-012** in [`docs/field-tests/20260307-buglog.md`](../../docs/field-tests/20260307-buglog.md)
- **Screenshot:** [`docs/field-tests/20260307-artifact-pooling.png`](../../docs/field-tests/20260307-artifact-pooling.png)

## Problem

Artifacts are rendered as a detached group in the chat transcript rather than inline with the message that produced them. When 10 artifacts arrive across different agent turns, all 10 `[ARTIFACT: ...]` cards stack together — disconnected from their originating messages.

**Expected:** Each artifact card appears directly below the agent message it arrived with, maintaining chronological order in the chat scroll.

**Actual:** All artifact cards pool together, creating a wall of artifact buttons unrelated to any specific message.

## Root Cause (Suspected)

Artifacts are stored in a flat `ConversationState.artifacts` list and rendered independently from the message list in `ChatTranscript`. There is no association between an artifact and the specific message that produced it.

## Proposed Fix

1. **Associate artifacts with messages:** Add a `messageId` (or timestamp-based association) to each artifact so it can be tied to the agent message it arrived with.
2. **Render inline:** In `ChatTranscript`, render a message's associated artifacts directly below that message entry rather than in a separate artifacts section.
3. **Fallback:** If an artifact arrives without a clear message association (e.g., before any agent message), render it at the current scroll position in the transcript.

## Acceptance Criteria
- [ ] Each artifact is associated with a specific agent message (by ID or timestamp proximity)
- [ ] Artifact cards render inline below their associated message in the chat transcript
- [ ] Artifacts maintain correct chronological ordering when scrolling through the transcript
- [ ] Artifact counter in status bar (`[ ARTIFACTS: N ]`) still shows the total count
- [ ] Tapping an inline artifact still opens the bottom sheet drawer
- [ ] Artifacts list modal still shows all artifacts across the session

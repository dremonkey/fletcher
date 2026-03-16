# Task 083: Remove XML Tag Parser — Render Thinking Directly from Deltas

**Epic:** 25 — Session Resumption
**Status:** [ ]
**Depends on:** TASK-082 (ACP thinking chunk passthrough)
**Blocks:** none

## Goal

Remove the stateless XML `<think>`/`<final>` tag parser (`parseAgentText()`) and the
`<think>` tag wrapping accumulator from TASK-082. Instead, render thinking content
directly from the structured `RelayThinkingDelta` events — no XML roundtrip.

## Context

TASK-079 built a streaming-aware XML parser (`agent_text_parser.dart`) to extract
`<think>` tags from raw text. TASK-082 introduces `agent_thought_chunk` as a separate
ACP update kind, giving us thinking content as structured deltas. Wrapping those deltas
back into `<think>` tags just to re-parse them is unnecessary complexity.

After TASK-082 lands, the thinking content arrives as:
```
RelayThinkingDelta("reasoning text...")  ← structured, separate from visible text
RelayContentDelta("visible response")    ← clean, no tags
```

There's no reason to serialize this into XML and parse it back out.

## Implementation

### 1. Update ConversationState / TranscriptEntry

**File:** `apps/mobile/lib/models/conversation_state.dart`

Add a `thinking` field to `TranscriptEntry`:

```dart
class TranscriptEntry {
  final String text;         // visible response text (no tags)
  final String? thinking;    // thinking content (null if none)
  // ... existing fields
}
```

### 2. Update livekit_service.dart

Remove `<think>` tag wrapping from TASK-082. Instead:
- Accumulate `RelayThinkingDelta` text into `_relayThinkingText`
- Accumulate `RelayContentDelta` text into `_relayAgentMessageText` (as today)
- When upserting transcript, pass both fields separately:
  `TranscriptEntry(text: visibleText, thinking: thinkingText)`

### 3. Update chat_transcript.dart

Remove `parseAgentText()` call. Instead, render directly from entry fields:

```dart
if (entry.thinking != null && entry.thinking!.isNotEmpty)
  ThinkingBlock(
    text: entry.thinking,
    state: entry.isFinal ? ThinkingState.complete : ThinkingState.inProgress,
  ),
if (entry.text.isNotEmpty)
  Text(entry.text, ...),
```

### 4. Delete agent_text_parser.dart

Remove `apps/mobile/lib/utils/agent_text_parser.dart` and its test file
`apps/mobile/test/utils/agent_text_parser_test.dart`. The partial-tag-holding,
streaming-aware XML parser is no longer needed.

### 5. Update tests

- Remove `agent_text_parser_test.dart` (45 tests)
- Update `chat_transcript` widget tests if any reference `parseAgentText`
- Add integration tests for direct thinking rendering

## Files to modify

| File | Change |
|------|--------|
| `apps/mobile/lib/models/conversation_state.dart` | Add `thinking` field to `TranscriptEntry` |
| `apps/mobile/lib/services/livekit_service.dart` | Remove `<think>` wrapping, pass thinking separately |
| `apps/mobile/lib/widgets/chat_transcript.dart` | Remove `parseAgentText()`, render from entry fields |
| `apps/mobile/lib/utils/agent_text_parser.dart` | **Delete** |
| `apps/mobile/test/utils/agent_text_parser_test.dart` | **Delete** |

## Acceptance criteria

- [ ] ThinkingBlock renders from `TranscriptEntry.thinking` field, not XML parsing
- [ ] No XML `<think>`/`<final>` tags anywhere in the rendering pipeline
- [ ] `agent_text_parser.dart` deleted
- [ ] Visible response text contains no tag artifacts
- [ ] ThinkingBlock works for both streaming and final renders
- [ ] All remaining tests pass

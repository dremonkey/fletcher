# Task 079: Parse `<think>` / `<final>` Tags in Agent Messages

**Epic:** 25 — Session Resumption
**Status:** [ ]
**Depends on:** none
**Blocks:** none (but prerequisite for clean session/load replay)

## Goal

Parse OpenClaw's `<think>` and `<final>` XML tags from agent message text so that:
- Thinking content (`<think>...</think>`) renders as a collapsible container — one summary line by default, expandable to full reasoning on tap
- Final content (`<final>...</final>`) renders as the normal agent response text
- Raw text with no tags renders as-is (backward compatible)

This applies to **both** live `session/update` streaming **and** `session/load` replay.

## Context

OpenClaw wraps agent responses in XML tags when reasoning is enabled:

```
<think>The user (identified as Fletcher) asked for a one-sentence summary
of the interaction so far, which consists of an introduction/math question
followed by a name confirmation.</think> <final>You introduced yourself as
Fletcher, we did some quick math, and I confirmed your name for you. ⚡️</final>
```

Today, the entire raw string (tags included) passes through the pipeline
unprocessed and appears as literal text in the chat transcript:

```
  AcpClient (session/update notification)
    → relay-bridge.ts:extractChunkText() — extracts content.text verbatim
    → forwardToMobile() — sends unmodified JSON-RPC to data channel
    → acp_update_parser.dart:_parseAgentMessageChunk() — wraps in AcpTextDelta
    → relay_chat_service.dart — wraps in RelayContentDelta
    → livekit_service.dart:1639 — accumulates in _relayAgentMessageText
    → _upsertTranscript() — stores raw text in TranscriptEntry.text
    → chat_transcript.dart:402 — renders Text(entry.text) with no parsing
```

**No component in this chain touches the text.** Tags show as raw `<think>` in the UI.

### Spike data (TASK-075)

From a 3-turn session/load replay, agent turns look like:
```json
{
  "sessionUpdate": "agent_message_chunk",
  "content": {
    "type": "text",
    "text": "<think>reasoning here</think> <final>visible response</final>"
  }
}
```

During live streaming, chunks arrive incrementally — a single agent turn may
come as 10-30 `agent_message_chunk` updates that get concatenated. Tags may
span multiple chunks (e.g., `<think>` opens in chunk 3, closes in chunk 12).

### Where to parse

Parsing should happen at the **rendering layer** (in the widget), not in the
relay or the model. Reasons:
- The relay is a transparent bridge — it should not interpret content
- `TranscriptEntry.text` should store the source-of-truth text (raw from server)
- Parsing at render time handles both live streaming and session/load replay
- If the tag format changes, only one widget needs updating

## Implementation

### 1. Tag parser utility (`apps/mobile/lib/utils/agent_text_parser.dart`)

New file. Pure function, no Flutter dependency:

```dart
class ParsedAgentText {
  final String? thinking;  // null if no <think> block
  final String visible;    // <final> content, or full text if no tags
}

ParsedAgentText parseAgentText(String raw) { ... }
```

Rules:
- Extract content between `<think>` and `</think>` → `thinking`
- Extract content between `<final>` and `</final>` → `visible`
- If no `<final>` tags, use everything outside `<think>` blocks as `visible`
- If no tags at all, `thinking = null`, `visible = raw` (backward compatible)
- Handle partial/malformed tags gracefully (treat as plain text)
- Strip leading/trailing whitespace from both fields

### 2. Thinking block widget (`apps/mobile/lib/widgets/thinking_block.dart`)

New widget. Collapsible container for agent reasoning:

```
  ┌──────────────────────────────────────────┐
  │ ◆ thinking ··· "The user asked for..."   │  ← collapsed (default)
  └──────────────────────────────────────────┘

  ┌──────────────────────────────────────────┐
  │ ◆ thinking                               │  ← expanded (on tap)
  │                                          │
  │ The user (identified as Fletcher) asked  │
  │ for a one-sentence summary of the inter- │
  │ action so far, which consists of an      │
  │ introduction/math question followed by   │
  │ a name confirmation.                     │
  └──────────────────────────────────────────┘
```

Design:
- Collapsed: single line with `◆ thinking` label + truncated preview (ellipsized)
- Expanded: full text, wrapped
- Tap to toggle
- Style: `AppColors.textSecondary` text, `AppTypography.overline` for label,
  `AppTypography.body` with `fontStyle: FontStyle.italic` for content
- No border/card — this sits inline within the agent message `TuiCard`
- Subtle visual separation: dimmer text color than the main response

### 3. Update `_TranscriptMessage` (`apps/mobile/lib/widgets/chat_transcript.dart`)

In `_TranscriptMessage.build()` (line ~368), for agent messages:

```dart
// Current (line 402-410):
Text(entry.text, style: ...)

// New:
if (isAgent) {
  final parsed = parseAgentText(entry.text);
  Column(children: [
    if (parsed.thinking != null) ThinkingBlock(text: parsed.thinking!),
    Text(parsed.visible, style: ...),
  ])
} else {
  Text(entry.text, style: ...)  // user messages unchanged
}
```

### 4. Tests

- `apps/mobile/test/utils/agent_text_parser_test.dart` — unit tests:
  - `<think>reasoning</think> <final>response</final>` → both fields
  - `<final>response only</final>` → thinking null, visible = response
  - `<think>reasoning</think> plain text after` → thinking + visible = plain text
  - No tags at all → thinking null, visible = raw
  - Empty `<think></think>` → thinking null (treat empty as absent)
  - Nested or malformed tags → graceful fallback to raw
  - Whitespace trimming
- `apps/mobile/test/widgets/thinking_block_test.dart` — widget tests:
  - Renders collapsed by default (single line, truncated)
  - Expands on tap, collapses on second tap
  - Long text truncated in collapsed state

## Acceptance criteria

- [ ] Agent messages with `<think>` tags show a collapsible thinking block above the response
- [ ] Agent messages with `<final>` tags show only the final content as the main response
- [ ] Agent messages with no tags render identically to today (no regression)
- [ ] Thinking block is collapsed by default, shows one-line preview
- [ ] Tapping thinking block expands to show full reasoning text
- [ ] Works for both live streaming and session/load replay
- [ ] Parser handles partial/malformed tags gracefully
- [ ] All unit and widget tests pass

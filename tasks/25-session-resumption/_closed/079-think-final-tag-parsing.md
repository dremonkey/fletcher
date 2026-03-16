# Task 079: Parse `<think>` / `<final>` Tags in Agent Messages

**Epic:** 25 — Session Resumption
**Status:** [x]
**Depends on:** none
**Blocks:** none (but prerequisite for clean session/load replay)

## Goal

Parse OpenClaw's `<think>` and `<final>` XML tags from agent message text so that:
- Thinking content (`<think>...</think>`) renders as a collapsible container — one summary line by default, expandable to full reasoning on tap
- Final content (`<final>...</final>`) renders as the normal agent response text
- Raw text with no tags renders as-is (backward compatible)
- **During live streaming, partial tags are held (not rendered) until confirmed** — no raw `<think>` or `<final>` tags ever flash in the UI

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

### Streaming-aware parsing (key design decision)

During live streaming, the accumulated text grows chunk by chunk. The parser
must handle partial tags at string boundaries without leaking raw XML to the UI:

```
Streaming progression (parser called on each render with full accumulated text):
═══════════════════════════════════════════════════════════════════════════════

Chunk 3:  "<"               → HOLD — could be start of tag
Chunk 4:  "<thi"            → HOLD — partial match for <think>
Chunk 5:  "<think>"         → Tag confirmed → thinkingState: inProgress
Chunk 8:  "<think>The user" → thinking: "The user" (streaming)
Chunk 12: "...</think>"     → thinkingState: complete
Chunk 14: "...</think> <"   → HOLD — could be start of <final>
Chunk 16: "...<final>"      → Start accumulating visible text
Chunk 20: "...<final>You introduced yourself" → visible streams in
Chunk 25: "...<final>.....</final>" → complete

State machine:
═══════════════

  ┌─────────┐   "<" detected    ┌──────────┐  confirmed    ┌──────────────┐
  │  PLAIN  │ ──────────────▶   │ HOLDING  │ ──────────▶   │ TAG ROUTED   │
  │ (render)│                   │ (buffer) │               │ (component)  │
  └─────────┘   ◀──────────────  └──────────┘               └──────────────┘
                  not a known tag     │
                                      │ partial match
                                      ▼
                                 keep holding
```

The parser is **stateless** — it re-parses the full accumulated string on each
render. The "holding" behavior comes from stripping partial tag matches from the
end of the string before returning.

## Implementation

### 1. Tag parser utility (`apps/mobile/lib/utils/agent_text_parser.dart`)

New file. Pure Dart function, no Flutter dependency:

```dart
enum ThinkingState { none, inProgress, complete }

class ParsedAgentText {
  final String? thinking;          // content inside <think>, null if none/empty
  final ThinkingState thinkingState;
  final String visible;            // content inside <final>, or outside tags

  const ParsedAgentText({
    this.thinking,
    this.thinkingState = ThinkingState.none,
    this.visible = '',
  });
}

ParsedAgentText parseAgentText(String raw) { ... }
```

**Parsing rules (in order):**

1. Look for `<think>` in the string
   - Not found → check for partial tag at end (see rule 6), return `thinkingState: none`, `visible: raw` (minus any held suffix)
2. `<think>` found, look for `</think>`
   - Not found → `thinkingState: inProgress`, `thinking: content after <think>` (trimmed), `visible: ""`
   - Found → `thinkingState: complete`, `thinking: content between tags` (trimmed). If trimmed content is empty, set `thinking: null`
3. After `</think>`, look for `<final>` in remainder
   - Not found → check for partial tag at end of remainder, `visible: remainder text` (minus any held suffix, trimmed)
4. `<final>` found, look for `</final>`
   - Not found → `visible: content after <final>` (trimmed, streaming)
   - Found → `visible: content between tags` (trimmed)
5. **Partial tag holding:** If the string ends with a prefix of any known tag (`<think>`, `</think>`, `<final>`, `</final>`), strip that suffix from whatever field it would appear in. Known tag prefixes to check: `<`, `<t`, `<th`, `<thi`, `<thin`, `<think`, `</`, `</t`, `</th`, `</thi`, `</thin`, `</think`, `<f`, `<fi`, `<fin`, `<fina`, `<final`, `</f`, `</fi`, `</fin`, `</fina`, `</final`.
6. **Graceful fallback:** If tags are malformed (e.g., nested `<think>`, stray `<`, etc.), treat as plain text — `thinkingState: none`, `visible: raw`

**Helper function for partial tag stripping:**

```dart
/// Strips a trailing partial tag match from [text].
/// Returns the text with the partial suffix removed.
/// Known tags: <think>, </think>, <final>, </final>
String _stripPartialTag(String text) {
  const tags = ['<think>', '</think>', '<final>', '</final>'];
  for (final tag in tags) {
    // Check if text ends with any prefix of this tag (length 1 to tag.length-1)
    for (int len = tag.length - 1; len >= 1; len--) {
      if (text.endsWith(tag.substring(0, len))) {
        return text.substring(0, text.length - len);
      }
    }
  }
  return text;
}
```

### 2. Thinking block widget (`apps/mobile/lib/widgets/thinking_block.dart`)

New StatefulWidget. Two modes based on `ThinkingState`:

**In-progress mode** (`thinkingState == inProgress`):
```
  ◆ thinking ···
```
Single line, not expandable. Uses `AppTypography.overline` + `AppColors.textSecondary`.
The `···` indicates streaming. No content shown (reasoning still arriving).

**Complete mode** (`thinkingState == complete`):
```
  ┌──────────────────────────────────────────┐
  │ ◆ thinking ··· "The user asked for..."   │  ← collapsed (default)
  └──────────────────────────────────────────┘

  ┌──────────────────────────────────────────┐
  │ ▼ thinking                               │  ← expanded (on tap)
  │                                          │
  │ The user (identified as Fletcher) asked  │
  │ for a one-sentence summary of the inter- │
  │ action so far, which consists of an      │
  │ introduction/math question followed by   │
  │ a name confirmation.                     │
  └──────────────────────────────────────────┘
```

**Widget API:**
```dart
class ThinkingBlock extends StatefulWidget {
  const ThinkingBlock({
    super.key,
    required this.text,
    required this.state,
  });

  final String? text;             // thinking content (may be null in inProgress)
  final ThinkingState state;      // inProgress or complete
}
```

**Design rules:**
- Collapsed (default): `◆ thinking` label + truncated preview in quotes (ellipsized, max 1 line)
- Expanded: `▼ thinking` label + full text wrapped, `fontStyle: FontStyle.italic`
- Tap to toggle (only when `state == complete`)
- `GestureDetector` for tap handler
- Style: `AppColors.textSecondary` for all text, `AppTypography.overline` for label, `AppTypography.body.copyWith(fontStyle: FontStyle.italic)` for content
- No border/card — sits inline within the agent message `TuiCard`
- Collapsed indicator: `◆` (diamond). Expanded indicator: `▼` (down triangle)
- `SizedBox(height: AppSpacing.xs)` between ThinkingBlock and visible text

### 3. Update `_TranscriptMessage` (`apps/mobile/lib/widgets/chat_transcript.dart`)

In `_TranscriptMessage.build()` (line ~368), for agent messages:

```dart
// Current (lines 402-410):
Text(
  entry.text,
  style: AppTypography.body.copyWith(
    fontStyle: entry.isFinal ? FontStyle.normal : FontStyle.italic,
    color: entry.isFinal ? AppColors.textPrimary : AppColors.textSecondary,
  ),
),

// New:
if (isAgent) ...[
  () {
    final parsed = parseAgentText(entry.text);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (parsed.thinkingState != ThinkingState.none)
          ThinkingBlock(text: parsed.thinking, state: parsed.thinkingState),
        if (parsed.thinkingState != ThinkingState.none && parsed.visible.isNotEmpty)
          const SizedBox(height: AppSpacing.xs),
        if (parsed.visible.isNotEmpty)
          Text(
            parsed.visible,
            style: AppTypography.body.copyWith(
              fontStyle: entry.isFinal ? FontStyle.normal : FontStyle.italic,
              color: entry.isFinal ? AppColors.textPrimary : AppColors.textSecondary,
            ),
          ),
      ],
    );
  }(),
] else ...[
  Text(
    entry.text,
    style: AppTypography.body.copyWith(
      fontStyle: entry.isFinal ? FontStyle.normal : FontStyle.italic,
      color: entry.isFinal ? AppColors.textPrimary : AppColors.textSecondary,
    ),
  ),
],
```

Add imports at top of file:
```dart
import '../utils/agent_text_parser.dart';
import 'thinking_block.dart';
```

### 4. Tests

#### `apps/mobile/test/utils/agent_text_parser_test.dart`

Unit tests for `parseAgentText()`:

**Complete messages (session/load replay or final render):**
- `<think>reasoning</think> <final>response</final>` → `thinking: "reasoning"`, `thinkingState: complete`, `visible: "response"`
- `<final>response only</final>` → `thinking: null`, `thinkingState: none`, `visible: "response only"`
- `<think>reasoning</think> plain text after` → `thinking: "reasoning"`, `thinkingState: complete`, `visible: "plain text after"`
- No tags at all → `thinking: null`, `thinkingState: none`, `visible: raw`
- Empty `<think></think>` → `thinking: null`, `thinkingState: complete`, `visible: ...`

**Streaming progression (simulating chunk accumulation):**
- `<think>reasoning so far` (unclosed think) → `thinkingState: inProgress`, `thinking: "reasoning so far"`, `visible: ""`
- `<think>reasoning</think> <final>partial response` (unclosed final) → `thinkingState: complete`, `thinking: "reasoning"`, `visible: "partial response"`
- `<think>reasoning</think> ` (think complete, no final yet) → `thinkingState: complete`, `thinking: "reasoning"`, `visible: ""`

**Partial tag holding:**
- String ending with `<` → held (not in visible)
- String ending with `<thi` → held
- String ending with `</think> <fin` → held (not in visible)
- `<think>reasoning</think> <` → `thinkingState: complete`, `visible: ""` (the `<` is held)

**Edge cases:**
- Whitespace trimming on both fields
- Nested or malformed tags → graceful fallback to raw
- Empty string → `visible: ""`

#### `apps/mobile/test/widgets/thinking_block_test.dart`

Widget tests:
- **Complete mode:** Renders collapsed by default (single line, `◆` icon, truncated preview)
- **Complete mode:** Expands on tap (shows full text, `▼` icon)
- **Complete mode:** Collapses on second tap
- **Complete mode:** Long text truncated with ellipsis when collapsed
- **In-progress mode:** Shows `◆ thinking ···` with no expand behavior
- **In-progress mode:** Tap does nothing (not expandable)

## Not in scope

- **Multiple `<think>` blocks per message** — OpenClaw sends exactly one per turn. YAGNI.
- **Tag parsing in relay or model layer** — parse at render time only; relay stays transparent.
- **Custom tag registry** — only `<think>` and `<final>` are supported. If new tags arrive, update the parser.
- **Persistent expand/collapse state** — resets on rebuild. Not worth the state management for a diagnostic feature.

## Relates to

- `tasks/25-session-resumption/EPIC.md` — parent epic
- `tasks/25-session-resumption/_closed/075-spike-session-load.md` — spike data informing tag format
- `apps/mobile/lib/widgets/chat_transcript.dart` — integration point
- `apps/mobile/lib/widgets/thinking_spinner.dart` — related but distinct (spinner = waiting for response, ThinkingBlock = showing reasoning content)

## Field-test findings (2026-03-15)

**Problem:** `<think>` tags never appear in the mobile UI despite OpenClaw having
reasoning/thinking enabled. The `ThinkingBlock` widget and `parseAgentText()` parser
work correctly in unit tests, but never trigger in production.

**Root cause investigation — full pipeline trace:**

Diagnostic logging was added at every stage of the pipeline:

| Level | Component | What we checked | Result |
|-------|-----------|----------------|--------|
| 1 | `acp-client` raw stdout | `line.includes("<think")` on every line from subprocess | **Never fired** |
| 2 | `relay-bridge.ts` | `contentType`, `hasThinkTag`, all `sessionUpdate` kinds | Every chunk: `type: "text"`, `hasThinkTag: false` |
| 3 | `acp_update_parser.dart` | Non-text content types, `<think>` in text | No non-text types, no think tags |
| 4 | `relay_chat_service.dart` | Dropped non-content updates, `<think>` detection | No think-related drops |
| 5 | `chat_transcript.dart` | `parseAgentText()` output | `thinkingState: none` on every render |

**Conclusion:** OpenClaw is NOT sending thinking content over the ACP protocol at all.
The `<think>` tags that OpenClaw logs internally are consumed and stripped before the
ACP subprocess emits `agent_message_chunk` notifications. No `content.thinking` field,
no separate `sessionUpdate` kind, no raw XML tags — thinking content simply doesn't
leave the subprocess.

**OpenClaw's self-diagnosis (hallucination):** When asked, OpenClaw claimed it "upgrades"
`<think>` tags into a structured `content.thinking` JSON field. This is plausible-sounding
but contradicted by all 5 levels of diagnostic evidence. The raw stdout check is
definitive — if `<think>` appeared anywhere in the JSON-RPC line (even as a field value),
the `raw_think_tag` log would have fired.

**Next steps:**
- This is an OpenClaw-side issue: ACP protocol needs to forward thinking content
- Options: (a) OpenClaw passes `<think>` tags through in `content.text` verbatim,
  (b) OpenClaw sends a separate `content.type: "thinking"` chunk, or
  (c) OpenClaw adds a new `sessionUpdate` kind for thinking
- Our parser and widget are ready for option (a) today
- Options (b)/(c) would require updates to `acp_update_parser.dart`

**Diagnostic logging commit:** `e248a57` — kept in place for future debugging

## Acceptance criteria

- [x] Agent messages with `<think>` tags show a collapsible thinking block above the response
- [x] Agent messages with `<final>` tags show only the final content as the main response
- [x] Agent messages with no tags render identically to today (no regression)
- [x] Thinking block is collapsed by default, shows one-line preview with `◆` indicator
- [x] Tapping thinking block expands to show full reasoning text with `▼` indicator
- [x] During live streaming, partial `<think>`/`<final>` tags are never visible — held until confirmed
- [x] Streaming shows `◆ thinking ···` indicator while `<think>` block is still receiving content
- [x] Works for both live streaming and session/load replay
- [x] Parser handles partial/malformed tags gracefully (fallback to raw text)
- [x] All unit and widget tests pass (30 parser + 15 widget = 45 total)

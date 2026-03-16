# Task 082: ACP Thinking Chunk Passthrough

**Epic:** 25 — Session Resumption
**Status:** [x]
**Depends on:** none
**Blocks:** none

## Goal

Enable OpenClaw's `agent_thought_chunk` updates to flow through the ACP pipeline
to the Fletcher mobile client, so the ThinkingBlock widget (TASK-079) actually
receives thinking content to render.

## Context

Field-test investigation (2026-03-15) traced the full pipeline and confirmed that
OpenClaw strips `<think>` tags from agent output before emitting `agent_message_chunk`
updates to ACP clients. The stripping happens in two layers inside OpenClaw's compiled
`reply-BEN3KNDZ.js`:

1. **Stream filter (line 111911):** `if (event.stream && event.stream !== "output") return;`
   — hard-coded drop of all `stream: "thought"` events before tag visibility check
2. **Tag visibility default (line 111346):** `agent_thought_chunk: false` in
   `ACP_TAG_VISIBILITY_DEFAULTS` — secondary block even if stream filter is bypassed

OpenClaw already has the infrastructure for `agent_thought_chunk` — it's a defined
`AcpSessionUpdateTag` with identical wire format to `agent_message_chunk`:
```json
{ "sessionUpdate": "agent_thought_chunk", "content": { "type": "text", "text": "..." } }
```

The relay bridge forwards all ACP updates transparently — no relay changes needed.
The mobile parser and ThinkingBlock widget (TASK-079) are already built but receive
no input because thinking never leaves the OpenClaw subprocess.

**Related OpenClaw issues:**
- [#37696](https://github.com/openclaw/openclaw/issues/37696) — documents `stripReasoningTagsFromText()` and its strict/preserve modes
- [#40393](https://github.com/openclaw/openclaw/issues/40393) — `thinking` setting not wired for ACP spawn
- New issue to file: stream filter blocks `agent_thought_chunk` even when tag visibility is enabled

## Implementation

### 1. Patch OpenClaw stream filter (1 line)

**File:** `~/.local/share/pnpm/global/5/.pnpm/openclaw@2026.3.12_.../dist/reply-BEN3KNDZ.js`
**Line 111911**

```js
// Before:
if (event.stream && event.stream !== "output") return;

// After — respect tag visibility for thought streams:
if (event.stream && event.stream !== "output" && !isAcpTagVisible(settings, event.tag)) return;
```

This is a local patch to the installed package. Will need to be re-applied on OpenClaw
upgrades until the upstream issue is resolved.

### 2. Add OpenClaw config for tag visibility

**File:** `~/.openclaw/openclaw.json`

Add `stream.tagVisibility` inside the existing `acp` block:

```json
"acp": {
  "stream": {
    "tagVisibility": {
      "agent_thought_chunk": true
    }
  }
}
```

### 3. Handle `agent_thought_chunk` in mobile parser

**File:** `apps/mobile/lib/services/relay/acp_update_parser.dart`

Add new result type:

```dart
final class AcpThinkingDelta extends AcpUpdate {
  final String text;
  const AcpThinkingDelta(this.text);
}
```

In `AcpUpdateParser.parse()`, add handler for `agent_thought_chunk`:

```dart
if (kind == 'agent_thought_chunk') {
  final content = update['content'];
  if (content is! Map<String, dynamic>) return null;
  final text = content['text'];
  if (text is! String) return null;
  return AcpThinkingDelta(text);
}
```

### 4. Route thinking deltas through relay chat service

**File:** `apps/mobile/lib/services/relay/relay_chat_service.dart`

Add new event type:

```dart
class RelayThinkingDelta extends RelayChatEvent {
  final String text;
  RelayThinkingDelta(this.text);
}
```

In `_handleSessionUpdate()`:

```dart
} else if (update is AcpThinkingDelta && update.text.isNotEmpty) {
  _activeStream?.add(RelayThinkingDelta(update.text));
}
```

### 5. Accumulate thinking text in livekit_service.dart

**File:** `apps/mobile/lib/services/livekit_service.dart`

- Add `_relayThinkingText` accumulator field
- In `_processRelayChatEvent`, handle `RelayThinkingDelta`:
  accumulate into `_relayThinkingText`
- When building the transcript entry text, prepend
  `<think>$_relayThinkingText</think>` so the existing `parseAgentText()` parser
  and ThinkingBlock widget work as-is
- Reset `_relayThinkingText` when the prompt completes

### 6. Tests

- `acp_update_parser_test.dart`: test `agent_thought_chunk` → `AcpThinkingDelta`
- `relay_chat_service_test.dart`: test `RelayThinkingDelta` routing

### 7. No relay changes needed

The relay bridge forwards ALL ACP updates transparently to the data channel.
`agent_thought_chunk` updates will flow through without any code changes.

## Verification

1. Restart OpenClaw (`openclaw restart`) to pick up config change
2. Restart relay (picks up thought chunks transparently)
3. Rebuild + install mobile app
4. Send a message that triggers thinking (use `/think high` first)
5. Check relay logs: should see `acp_update_kind: "agent_thought_chunk"` entries
6. Check device logcat: should see `AcpThinkingDelta` logs
7. Verify ThinkingBlock renders in the UI — collapsed by default, expandable on tap

## Not in scope

- Upstream OpenClaw fix (separate issue)
- Re-applying the patch on OpenClaw upgrades (manual for now)
- Thinking content during session/load replay (may need separate handling)

## Acceptance criteria

- [x] OpenClaw emits `agent_thought_chunk` updates when thinking is enabled
- [x] Mobile parser produces `AcpThinkingDelta` for thought chunks
- [~] ThinkingBlock widget renders thinking content from live ACP stream (needs field test)
- [~] Thinking block is collapsed by default, expandable on tap (needs field test)
- [x] Normal (non-thinking) messages render identically to today
- [x] Tests pass for new parser and service event types

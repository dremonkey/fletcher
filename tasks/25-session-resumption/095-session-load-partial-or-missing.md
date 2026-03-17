# Task 095: Fix session history load — partial or missing messages

## Problem

When connecting to a new room within the same session (same `sessionKey`, different
room name), the session history load is unreliable. (BUG-047)

1. **Blank transcript:** No history loads despite the ACP backend having full conversation.
2. **Partial history:** Only one merged agent message appears; all user messages missing.

## Investigation

### Theory 1: `_needsSessionLoad` is never `true` for new rooms in a continuing session

**Confirmed — root cause for blank transcripts.** The flag is set at
`livekit_service.dart:238`:

```dart
_needsSessionLoad = recentRoom != null;
```

This is `true` ONLY when `SessionStorage.getRecentRoom()` returns a non-null room name,
meaning the previous room is within the 120s staleness threshold. In chat mode, the app
disconnects immediately on background (`onAppBackgrounded` line 2267-2271). After >120s,
the room is stale, `getRecentRoom()` returns null, a new room is generated, but
`_needsSessionLoad = false`.

The session key is unchanged, the ACP backend has full history, but
`_loadSessionHistory()` is never called.

Same issue in `_connectToNewRoom()` (line 328-376) — it never sets the flag either.

### Theory 2: `user_message_chunk` kind not handled in parser

**Confirmed — root cause for partial history.** OpenClaw's `session/load` emits user
turns as `user_message_chunk` (documented in `tasks/25-session-resumption/075-spike-results.md:48`),
but `AcpUpdateParser.parse()` at `acp_update_parser.dart:236` only handles `user_message`.

The `user_message_chunk` falls through to `AcpNonContentUpdate`, which is silently
dropped by `RelayChatService._handleSessionUpdate()`. Without user message delimiters,
`_loadSessionHistory()` never calls `finalizeAgentTurn()` between turns — all agent
chunks from ALL turns accumulate into one giant concatenated entry.

Result: one merged agent message containing all responses, zero user messages.

### Theory 3: `_needsSessionLoad` consumed once and never re-set

**Confirmed — contributing cause.** The flag is consumed (set to `false`) on first
successful bind (line 961). On subsequent reconnects within the same session, it stays
`false`. This is acceptable when in-memory transcript is preserved, but fails when
the transcript is lost (app killed, not just backgrounded).

### Theory 4: `_loadSessionHistory()` is fire-and-forget

**Confirmed — contributing cause.** At line 962, the call is not awaited and has no
error handling. If it throws (relay dies mid-load, timeout, parse error), the error
is uncaught and `_isReplaying` may stay `true` forever, suppressing auto-scroll.

## Proposed Fix

### Change 1: Add `user_message_chunk` handling to AcpUpdateParser (CRITICAL)

**File:** `apps/mobile/lib/services/relay/acp_update_parser.dart`
**Location:** Near the `user_message` handler (~line 236)

`user_message_chunk` uses the `content` structure (same as `agent_message_chunk`),
not the `prompt` array:

```dart
if (kind == 'user_message_chunk') {
  final content = update['content'];
  if (content is! Map<String, dynamic>) return null;
  if (content['type'] != 'text') return null;
  final text = content['text'];
  if (text is! String) return null;
  return AcpUserMessage(text);
}
```

### Change 2: Set `_needsSessionLoad = true` in `_connectToNewRoom()` (CRITICAL)

**File:** `apps/mobile/lib/services/livekit_service.dart`
**Location:** `_connectToNewRoom()` (~line 328)

When creating a new room for a continuing session (session key exists), set the flag:

```dart
Future<void> _connectToNewRoom() async {
  final roomName = await _generateRoomName();
  _currentRoomName = roomName;
  _needsSessionLoad = true;  // ACP backend may have history for this session
  // ...
}
```

### Change 3: Decouple history load from room staleness (CRITICAL)

**File:** `apps/mobile/lib/services/livekit_service.dart`
**Location:** `connectWithDynamicRoom()` (~line 238)

Always request session history when a session key pre-existed (not just generated):

```dart
// Always load session history if a persisted session key exists
final prefs = await SharedPreferences.getInstance();
final hadExistingSession = prefs.containsKey('fletcher_session_key');
_needsSessionLoad = hadExistingSession;
```

### Change 4: Add error handling to `_loadSessionHistory()` call

**File:** `apps/mobile/lib/services/livekit_service.dart`
**Location:** Bind response handler (~line 962)

```dart
if (_needsSessionLoad) {
  _needsSessionLoad = false;
  _loadSessionHistory().catchError((e) {
    debugPrint('[Fletcher] Session history load failed: $e');
    _isReplaying = false;
  });
}
```

### Change 5: Add logging for dropped ACP update kinds during replay

**File:** `apps/mobile/lib/services/relay/relay_chat_service.dart`
**Location:** `_handleSessionUpdate()` (~line 239)

Log unrecognized update kinds during session load to make future parsing issues
visible instead of silent.

## Acceptance Criteria

- [ ] `user_message_chunk` from `session/load` produces `AcpUserMessage` entries
- [ ] Session history loads correctly after app restart (>120s background in chat mode)
- [ ] All turns (user + agent) appear in correct order after history load
- [ ] `_connectToNewRoom()` triggers history load for existing sessions
- [ ] `_loadSessionHistory()` errors don't leave `_isReplaying = true` forever
- [ ] Unrecognized ACP update kinds during replay are logged (not silent)

## Files

- `apps/mobile/lib/services/relay/acp_update_parser.dart` — `user_message_chunk` parsing
- `apps/mobile/lib/services/livekit_service.dart` — `_needsSessionLoad` flag, error handling
- `apps/mobile/lib/services/relay/relay_chat_service.dart` — replay logging

## Status

- **Date:** 2026-03-16
- **Priority:** MED
- **Bug:** BUG-047
- **Status:** RCA COMPLETE — ready for implementation

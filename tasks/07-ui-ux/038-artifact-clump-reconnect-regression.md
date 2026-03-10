# Task 038: Fix Artifact Clump Regression After Agent Reconnect

## Problem

After an agent sleep/wake cycle, all artifacts from the new session clump under the
last message of the *previous* session instead of being distributed across the messages
that produced them. Observed in field testing (BUG-004, 2026-03-10): 5 "Voice Degraded"
artifacts spanning 15 minutes all appeared stacked under one old message.

This is a regression of task 023 (Artifact–Message Association), which is complete and
closed. The fix in task 023 works correctly within a single session; it breaks when the
on-demand dispatch lifecycle (Epic 20) causes the agent to disconnect and reconnect
within the same room visit.

---

## Investigation

### Theory v1 — Stale `_lastAgentSegmentId` (Confirmed)

**`apps/mobile/lib/services/livekit_service.dart:50`**
```dart
/// Tracks the most recent agent transcript segment ID so that artifacts
/// arriving via the data channel can be associated with the agent message
/// that produced them (BUG-012 / TASK-023).
String? _lastAgentSegmentId;
```

This variable is updated every time an `agent_transcript` event arrives
(`livekit_service.dart:861`):
```dart
// Track the latest agent segment ID for artifact association (TASK-023)
_lastAgentSegmentId = segmentId;
```

And every artifact is stamped with its current value (`livekit_service.dart:842–844`):
```dart
final stamped = _lastAgentSegmentId != null
    ? artifactEvent.withMessageId(_lastAgentSegmentId)
    : artifactEvent;
```

**The problem:** `_lastAgentSegmentId` is **never cleared** when the agent disconnects.
Neither `ParticipantDisconnectedEvent` handler nor `ParticipantConnectedEvent` handler
resets it.

**`livekit_service.dart:597–618` — `ParticipantDisconnectedEvent` handler:**
```dart
_listener?.on<ParticipantDisconnectedEvent>((event) {
  final remaining = _room?.remoteParticipants.length ?? 0;
  // ...
  if (remaining == 0) {
    _updateState(diagnostics: ...);
    agentPresenceService.onAgentDisconnected();
  }
  // ← NO _lastAgentSegmentId = null here
});
```

### Trigger Chain (100% reproduction with any sleep/wake that produces artifacts)

```
T=0      Session A: user speaks, agent responds.
         Last agent message has segmentId = "seg-abc".
         _lastAgentSegmentId = "seg-abc".

T=5min   Idle timeout → agent disconnects.
         _lastAgentSegmentId still = "seg-abc". ← STALE

T=5min+  Session B: user speaks, agent reconnects.
         New session begins. Agent starts speaking.
         While TTS is active (or immediately after), Piper fallback fires
         "Voice Degraded" artifact via data channel.

T=+0.1s  Artifact arrives BEFORE any agent_transcript event from session B.
         _lastAgentSegmentId = "seg-abc" (stale) → artifact stamped with "seg-abc".

T=+0.2s  Agent transcript starts streaming → _lastAgentSegmentId = "seg-xyz" (new).
         But subsequent artifacts from session B turns are also stamped "seg-xyz"
         (or "seg-abc" for any that race the first transcript event).

Result:  All session B artifacts share the stale stamp "seg-abc".
         ChatTranscript._groupArtifactsByMessage() correctly groups them
         under the "seg-abc" message — the last message of session A.
         Observed as a clump of 5 artifacts under one old message.
```

**Why the transcript is preserved:** Epic 20 on-demand dispatch keeps the user in the
same room; the Flutter app preserves transcript state across the sleep/wake cycle (task
005). The stale `"seg-abc"` ID therefore *does* exist in the transcript, so the grouping
logic places all artifacts there rather than falling back to the nearest agent message.

### Test gap

`apps/mobile/test/models/artifact_message_association_test.dart` covers the in-session
grouping logic thoroughly but has no test for the reconnection scenario.

---

## Proposed Fix

**One line** in `ParticipantDisconnectedEvent` handler,
`apps/mobile/lib/services/livekit_service.dart`:

**Before (`livekit_service.dart:602–608`):**
```dart
if (remaining == 0) {
  _updateState(
    diagnostics: _state.diagnostics.copyWith(clearAgentIdentity: true),
  );
  // Notify agent presence service (Epic 20)
  agentPresenceService.onAgentDisconnected();
}
```

**After:**
```dart
if (remaining == 0) {
  _updateState(
    diagnostics: _state.diagnostics.copyWith(clearAgentIdentity: true),
  );
  // Notify agent presence service (Epic 20)
  agentPresenceService.onAgentDisconnected();
  // Reset segment ID so artifacts from the new session are not stamped
  // with the stale ID from the previous session. (BUG-004)
  _lastAgentSegmentId = null;
}
```

When `_lastAgentSegmentId` is null, the artifact stamping code at line 842 leaves
`messageId` as null. `ChatTranscript._groupArtifactsByMessage()` then falls back to the
nearest prior agent message — which for session B will be the session B message that
produced the artifact (once that message arrives), or the last message in the transcript
as a reasonable fallback for artifacts that race the first transcript event.

---

## Edge Cases

**Artifact races transcript text (same turn):** A "Voice Degraded" artifact can arrive
before the first `agent_transcript` event of the new session. With the fix, this artifact
gets `messageId = null` and falls back to the nearest prior agent message. Once the new
session's first transcript entry exists, subsequent artifacts in that turn will be
correctly stamped. Acceptable — the race window is narrow and the fallback is sensible.

**Multiple quick reconnects:** Each disconnect clears the ID; each new session builds it
fresh from the first transcript event. No accumulation of stale state.

**Normal in-session behavior unchanged:** `_lastAgentSegmentId` is still updated on
every `agent_transcript` event. Artifacts mid-session continue to be correctly stamped.

**Session B produces no transcript (silent mode / TTS-only artifacts):** With
`_lastAgentSegmentId = null`, all artifacts fall back to the nearest prior agent message.
This is the same behavior as task 023's original null-fallback path and is acceptable.

---

## Acceptance Criteria

- [ ] After an agent sleep/wake cycle, artifacts from the new session appear under the
      agent messages that produced them, **not** under any message from the old session.
- [ ] Within a single session (no disconnect), artifact-to-message association is
      unchanged (regression check for task 023 behavior).
- [ ] An artifact that arrives before the first `agent_transcript` event of a new session
      falls back gracefully to the nearest prior agent message (no crash, no null error).
- [ ] Add a unit/widget test covering the reconnection scenario: artifact arrives with
      stale segment ID is NOT grouped under the old message after `_lastAgentSegmentId`
      is reset.

---

## Files

- `apps/mobile/lib/services/livekit_service.dart` — add `_lastAgentSegmentId = null`
  in `ParticipantDisconnectedEvent` handler when `remaining == 0`
- `apps/mobile/test/` — add reconnection scenario test

---

## Status

**Date:** 2026-03-10
**Priority:** High (100% reproduction rate, HIGH visibility regression)
**Status:** RCA Complete — one-line fix + test
**Field test:** [BUG-004](../../docs/field-tests/20260310-buglog.md)

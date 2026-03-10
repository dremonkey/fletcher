# Task 010: Unmute as Agent Dispatch Trigger

**Epic:** 20 — Agent Cost Optimization
**Status:** Complete
**Priority:** Medium

## Problem

When the agent is absent (idle-disconnected) and the user unmutes their microphone, nothing happens until they actually speak and the audio-level speech detection triggers dispatch. Unmuting is a strong intent signal — the user is preparing to talk. We can use this to get a head start on dispatch, shaving ~300-500ms off the perceived latency.

## Proposed Solution

In `toggleMute()`, when transitioning from muted → unmuted while the agent is absent, immediately trigger dispatch:

```dart
Future<void> toggleMute() async {
  _isMuted = !_isMuted;
  debugPrint('[Fletcher] Mute toggled: muted=$_isMuted');

  if (_isMuted) {
    _updateState(status: ConversationStatus.muted);
  } else {
    _updateState(status: ConversationStatus.idle);
    // Unmuting while agent is absent is a clear intent signal —
    // dispatch immediately for a head start (Epic 20, Task 010).
    if (agentPresenceService.enabled &&
        agentPresenceService.state == AgentPresenceState.agentAbsent) {
      debugPrint('[Fletcher] Unmute while agent absent — triggering dispatch');
      agentPresenceService.onSpeechDetected();
    }
  }

  await _localParticipant?.setMicrophoneEnabled(!_isMuted);
  debugPrint('[Fletcher] Mic ${_isMuted ? "stopped" : "started"}');
}
```

## Edge Cases

- **User unmutes then immediately re-mutes:** Agent dispatches but nobody speaks. Agent will idle-timeout again. Acceptable — dispatch is cheap (~150ms overhead), and this case is rare.
- **User unmutes while agent is dispatching:** `onSpeechDetected()` is already a no-op when in `dispatching` state (line 110-112 of `AgentPresenceService`). Safe.
- **User unmutes while agent is present:** No-op — `agentPresenceService.state != agentAbsent`. Safe.
- **On-demand dispatch disabled:** `agentPresenceService.enabled` is false. Safe.

## Files to Modify

- `apps/mobile/lib/services/livekit_service.dart` — add dispatch trigger in `toggleMute()`

## Acceptance Criteria

- [x] Unmuting while agent is absent triggers immediate dispatch
- [x] Unmuting while agent is present/dispatching does nothing extra
- [x] Unmuting while on-demand dispatch is disabled does nothing extra
- [x] Agent connects before (or as) the user starts speaking

## Dependencies

- Task 005 (Client State Machine) — provides `AgentPresenceState` and `onSpeechDetected()`

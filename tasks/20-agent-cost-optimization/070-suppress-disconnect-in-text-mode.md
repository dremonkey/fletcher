# TASK-070: Suppress Agent Disconnect When Not in Voice Mode

**Status:** [ ] Not started
**Priority:** MEDIUM
**Epic:** 20 — Agent Cost Optimization

## Problem

When the hold timer fires and the agent disconnects, the system event card always appears — even when the user is in text input mode chatting via relay. From the user's perspective, nothing changed: the relay is still in the room, the ACP session is alive, and text messages continue flowing. The "Live mode paused" card is confusing noise.

The voice agent is a voice-mode resource. Its departure should only be communicated when the user is actively in voice mode (or was recently).

## Design

### When to show the hold disconnect event

| User state | Agent hold disconnect | Show event? |
|---|---|---|
| Voice mode active (`isVoiceModeActive == true`) | Yes | **Yes** — user needs to know voice pipeline is paused |
| Voice mode muted via histogram (`isVoiceModeActive == true`, `isMuted == true`) | Yes | **Yes** — user is still in voice mode, just muted |
| Text input mode (`inputMode == textInput`) | Yes | **No** — relay handles chat, agent is irrelevant |
| Initial state (muted, voiceFirst, never activated voice) | Yes | **No** — user hasn't entered voice mode yet |

### Behavior when suppressed

- No system event card in transcript
- `AgentPresenceService` still transitions to `agentAbsent` (so re-dispatch works when user enters voice mode later)
- If user later switches to voice mode (taps mic → `toggleInputMode()` → unmutes), the normal dispatch flow fires via `onSpeechDetected()`

## Implementation

### 1. Pass voice mode state to AgentPresenceService

Add the voice mode context to `onAgentDisconnected()`:

```dart
void onAgentDisconnected({bool holdMode = false, bool voiceModeActive = false}) {
  if (!_enabled) return;
  _holdMode = holdMode;
  _suppressEvent = holdMode && !voiceModeActive;
  _transitionTo(AgentPresenceState.agentAbsent);
}
```

### 2. Suppress event emission

In `_emitTransitionEvent()`, skip the system event when suppressed:

```dart
case AgentPresenceState.agentAbsent:
  if (from == AgentPresenceState.agentPresent && !_suppressEvent) {
    onSystemEvent!(...);
  }
  _holdMode = false;
  _suppressEvent = false;
  break;
```

### 3. Wire from LiveKitService

In the `ParticipantDisconnectedEvent` handler:

```dart
agentPresenceService.onAgentDisconnected(
  holdMode: wasHoldMode,
  voiceModeActive: isVoiceModeActive,
);
```

Also suppress the raw `agent-disconnect-<ts>` event when hold mode + not in voice mode.

## Files to Modify

- `apps/mobile/lib/services/agent_presence_service.dart` — add `voiceModeActive` param, suppress logic
- `apps/mobile/lib/services/livekit_service.dart` — pass `isVoiceModeActive` to `onAgentDisconnected()`

## Dependencies

- TASK-069 (hold mode visual treatment) — should be implemented first
- Voice mode active flag (TASK-059) — implemented

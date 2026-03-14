# 072: Bootstrap "Connecting" State in UI

**Status:** [ ] Not started
**Priority:** Medium
**Depends on:** BUG-031 fix (bootstrap non-interruptible + `bootstrap` events)

## Problem

When the user activates voice mode (taps mic), there's a 3-4 second window where the voice agent is bootstrapping (injecting TTS/STT instructions into the ACP session). During this time:

1. The agent is not ready to accept user speech
2. The UI shows no indication that setup is in progress
3. If the user speaks immediately, their speech is lost or creates confusing behavior

## Data Channel Events (Already Implemented)

The voice agent now sends `bootstrap` events on the `ganglia-events` data channel:

```json
{ "type": "bootstrap", "phase": "start" }
{ "type": "bootstrap", "phase": "end" }
```

- `bootstrap_start` fires when voice mode is activated (mic toggle)
- `bootstrap_end` fires when the bootstrap LLM round-trip completes (~3-4s later)
- Bootstrap is non-interruptible (`allowInterruptions: false`), so user speech during this window is safely queued by the SDK

## Requirements

### Must Have
- [ ] Parse `bootstrap` events in `LiveKitService` data channel handler
- [ ] Show a visual indicator during bootstrap (between `start` and `end`)
- [ ] Indicator should be distinct from "thinking" — this is setup, not a response
- [ ] Auto-dismiss when `bootstrap_end` arrives
- [ ] Timeout fallback: auto-dismiss after 10s if `bootstrap_end` never arrives

### Nice to Have
- [ ] Suppress pondering phrases during bootstrap (the bootstrap generates "thinking..." status events that aren't meaningful to the user)
- [ ] Subtle animation on the mic button or orb area (pulsing, dimmed, etc.)
- [ ] System event in chat transcript: "Voice mode activated" on end

## Design Considerations

- Keep it minimal — a status bar message ("Connecting...") or mic button state change is sufficient
- Don't block the UI — text input should still work during bootstrap
- The bootstrap window is short (3-4s) so the indicator shouldn't be jarring

## Related

- BUG-031: Bootstrap barge-in kills first voice responses (root cause for this task)
- BUG-023: Bootstrap deferred until voice activation
- `apps/voice-agent/src/agent.ts` — bootstrap event emission
- `apps/voice-agent/src/bootstrap.ts` — bootstrap message content
- `apps/mobile/lib/services/livekit_service.dart` — data channel handler

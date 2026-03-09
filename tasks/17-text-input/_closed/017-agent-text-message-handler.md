# Task 017: Agent-Side Text Message Handler

**Status:** [x] Complete
**Epic:** [17 — Text Input Mode](./EPIC.md)
**Depends on:** Task 010 (Text Message Routing — client side done)

## Goal

Handle `text_message` events from the mobile client on the voice agent's `ganglia-events` data channel, injecting typed text into the LLM pipeline as a user message.

## Context

The Flutter client (Epic 17) sends text messages via the LiveKit data channel:

```typescript
interface TextMessageEvent {
  type: 'text_message';
  text: string;
}
```

The voice agent needs to receive this event and feed the text to the LLM, producing a response via the normal TTS + transcript flow. This completes the text input round-trip.

## Implementation

In `apps/voice-agent/src/agent.ts`, inside the existing `RoomEvent.DataReceived` handler (line ~255):

```typescript
if (event.type === 'text_message' && typeof event.text === 'string' && event.text.trim()) {
  logger.info({ text: event.text, participant: participant?.identity }, 'Text message received');
  session.generateReply({ userInput: event.text });
}
```

This follows the exact same pattern as:
- `tts-mode` handler (line 259) — same event listener, same JSON parse
- Bootstrap message (line 462) — same `session.generateReply()` call

## Acceptance Criteria

- [x] Voice agent handles `text_message` events on `ganglia-events` data channel
- [x] Text is validated (non-empty string, trimmed)
- [x] `session.generateReply()` is called with the user's text
- [x] Agent responds via normal TTS + transcript pipeline
- [x] Event is logged at info level with participant identity
- [x] Empty or whitespace-only messages are ignored
- [ ] Unit test covers the handler logic — deferred; agent.ts has no unit test file and the handler is inline in the entry function (tightly coupled to LiveKit SDK types)

## Architecture Reference

See [Data Channel Protocol — Text Message](../../docs/architecture/data-channel-protocol.md#text-message-epic-17) for the protocol definition.

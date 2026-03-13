# Task: Add chunk-level debug logging to relay pipeline

## Background

Found during field testing (2026-03-12, BUG-006). A chat response arrived
truncated — last 3 words missing. The relay logged `stopReason: end_turn` so
from the backend's view the response completed. But without chunk-level logging
we cannot distinguish between:

1. OpenClaw stopped generating mid-phrase (LLM truncation)
2. Last DataChannel packet(s) dropped in transit
3. Mobile rendering race (stream closed before last delta rendered)

Currently the relay only logs high-level lifecycle events (`mobile_prompt_received`,
`session_prompt_result`). Individual `session/update` chunk payloads are never
logged anywhere.

## Goal

Add DEBUG-level logging for each ACP chunk so future truncation bugs are
immediately diagnosable without needing a full reproduction.

## Proposed Changes

### Relay side (`apps/relay/src/`)

In `acp/client.ts` (or wherever `session/update` notifications come in),
log each chunk at DEBUG level:

```ts
log.debug({ sessionUpdate: update.sessionUpdate, textLen: text?.length }, 'acp chunk');
```

In `bridge/relay-bridge.ts`, log when each chunk is forwarded to mobile:

```ts
log.debug({ correlationId, sessionUpdate: kind, textLen }, 'forwarded chunk to mobile');
```

Use `LOG_LEVEL=debug` to enable. These should be silent at default `info` level.

### Mobile side (`lib/services/relay/relay_chat_service.dart`)

In `_handleSessionUpdate()`, log each received delta:

```dart
debugPrint('[Fletcher] relay chunk: ${update.text.length} chars');
```

This gives client-side evidence even when the relay is healthy.

## Checklist

- [ ] Relay logs each `session/update` chunk at DEBUG level (kind + text length)
- [ ] Relay logs each forwarded chunk (correlationId + text length)
- [ ] Mobile logs each `RelayContentDelta` length in debug builds
- [ ] Verify `LOG_LEVEL=info` suppresses relay chunk logs (no noise in prod)
- [ ] Verify `LOG_LEVEL=debug` shows chunk stream during a test conversation

## Related

- Bug: `docs/field-tests/20260312-buglog.md` BUG-006
- `apps/relay/src/acp/client.ts`
- `apps/relay/src/bridge/relay-bridge.ts`
- `apps/mobile/lib/services/relay/relay_chat_service.dart`

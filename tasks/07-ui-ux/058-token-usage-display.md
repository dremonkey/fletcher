# TASK-058: Token Usage Display in Mobile UI

**Status:** [ ] Not started
**Priority:** Medium
**Epic:** 07 (UI/UX)
**Origin:** Field test feedback (2026-03-12)

## Problem

OpenClaw already emits `usage_update` events via ACP (`sessionUpdate: "usage_update"`, with `used` and `size` fields), and the relay forwards them to mobile. But the mobile app ignores these events — there's no UI to show token consumption.

Users want visibility into how much context is being used, especially during long sessions or tool-heavy interactions.

## Evidence

Relay log shows usage data flowing through:
```json
{
  "sessionUpdate": "usage_update",
  "used": 35224,
  "size": 1048576,
  "_meta": { "source": "gateway-session-store", "approximate": true }
}
```

This data is already forwarded to mobile but silently dropped by `AcpUpdateParser` (classified as `AcpNonContentUpdate`).

## Requirements

- [ ] **Mobile:** Parse `usage_update` in `AcpUpdateParser` — extract `used` and `size` fields
- [ ] **Mobile:** Surface token usage in the UI — NOT inline with chat messages
- [ ] **Mobile:** Display as a persistent but unobtrusive indicator (e.g., in the diagnostics bar, header, or a dedicated metrics area)
- [ ] Show usage as a fraction or percentage (e.g., `35K / 1M tokens` or `3.4%`)
- [ ] Visual warning when usage exceeds thresholds (e.g., 75% yellow, 90% red)

## Design Considerations

The user explicitly said token usage should NOT be inline with chat. Good placement options:
1. **Diagnostics bar** — add a `TOK` metric alongside existing `SYS/VAD/RT`
2. **Header area** — compact indicator near the TTS toggle
3. **Expandable diagnostics modal** — detailed breakdown in the existing diagnostics panel

Option 1 (diagnostics bar) is the most natural fit — it's already a metrics surface.

## Files

- `apps/mobile/lib/services/relay/acp_update_parser.dart` — parse `usage_update`
- `apps/mobile/lib/blocs/conversation_bloc.dart` — store/emit usage state
- `apps/mobile/lib/widgets/diagnostics_bar.dart` — render usage indicator
- `apps/mobile/lib/widgets/diagnostics_modal.dart` — detailed usage view (optional)

## Related

- Task 038: Verbose ACP Tool Feedback (also parses new ACP update types)
- Task 024: Diagnostics Panel — Live Pipeline Values (existing diagnostics surface)

## Definition of Done

- [ ] `usage_update` events parsed and stored in app state
- [ ] Token usage visible in the diagnostics bar or equivalent surface
- [ ] Visual threshold warnings at 75% and 90%
- [ ] Unit tests for parser and state management

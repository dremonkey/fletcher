# Task 058: Token Usage Display in Mobile UI

**Epic:** 07 — UI/UX (TUI Brutalist)
**Status:** [x]
**Depends on:** none
**Blocks:** none

## Goal

Surface token usage data (already flowing from OpenClaw via ACP `usage_update` events) in the mobile diagnostics bar. Users need visibility into context window consumption, especially during long sessions or tool-heavy interactions.

## Context

OpenClaw emits `usage_update` events via ACP:
```json
{
  "sessionUpdate": "usage_update",
  "used": 35224,
  "size": 1048576,
  "_meta": { "source": "gateway-session-store", "approximate": true }
}
```

The relay forwards these transparently to mobile. The mobile `AcpUpdateParser` currently classifies them as `AcpNonContentUpdate('usage_update')` — the data is silently dropped.

The diagnostics bar (`DiagnosticsBar`) already shows `SYS | VAD | RT` metrics. Token usage fits naturally as a fourth metric: `TOK`.

### Data flow

```
OpenClaw → ACP session/update → Relay (passthrough) → Mobile data channel
  → RelayChatService._handleUpdate()
  → AcpUpdateParser.parse()
  → NEW: AcpUsageUpdate(used, size)
  → LiveKitService / ConversationState
  → DiagnosticsBar: TOK metric
```

## Implementation

### 1. Add `AcpUsageUpdate` class (`apps/mobile/lib/services/relay/acp_update_parser.dart`)

Add a new sealed class variant:

```dart
final class AcpUsageUpdate extends AcpUpdate {
  final int used;
  final int size;
  const AcpUsageUpdate({required this.used, required this.size});
  double get percentage => size > 0 ? used / size : 0.0;
}
```

Update `AcpUpdateParser.parse()` to handle `'usage_update'`:

```dart
if (kind == 'usage_update') {
  final used = update['used'];
  final size = update['size'];
  if (used is! int || size is! int) return null;
  return AcpUsageUpdate(used: used, size: size);
}
```

### 2. Add token usage to state (`apps/mobile/lib/models/conversation_state.dart`)

Add fields to `DiagnosticsInfo`:

```dart
final int? tokenUsed;
final int? tokenSize;

String? get tokenDisplay {
  if (tokenUsed == null || tokenSize == null) return null;
  final usedK = (tokenUsed! / 1000).toStringAsFixed(0);
  final sizeK = tokenSize! >= 1000000
    ? '${(tokenSize! / 1000000).toStringAsFixed(0)}M'
    : '${(tokenSize! / 1000).toStringAsFixed(0)}K';
  return '${usedK}K / $sizeK';
}

double? get tokenPercentage =>
  tokenUsed != null && tokenSize != null && tokenSize! > 0
    ? tokenUsed! / tokenSize!
    : null;
```

Add `tokenUsed` and `tokenSize` to the `copyWith()` method.

### 3. Wire update to state (`apps/mobile/lib/services/livekit_service.dart`)

In the relay chat service's update handler (where `AcpUpdate` results are processed), add handling for `AcpUsageUpdate`:

```dart
if (update is AcpUsageUpdate) {
  _updateState(state.copyWith(
    diagnostics: state.diagnostics.copyWith(
      tokenUsed: update.used,
      tokenSize: update.size,
    ),
  ));
}
```

### 4. Add TOK metric to DiagnosticsBar (`apps/mobile/lib/widgets/diagnostics_bar.dart`)

In the inline metrics `Text.rich()`, add a fourth metric after RT:

```dart
if (diagnostics.tokenDisplay != null) ...[
  TextSpan(text: ' | ', style: pipeStyle),
  TextSpan(text: 'TOK: ', style: metricStyle),
  TextSpan(
    text: diagnostics.tokenDisplay!,
    style: metricStyle.copyWith(color: _tokenColor),
  ),
],
```

Color logic:
```dart
Color get _tokenColor {
  final pct = diagnostics.tokenPercentage;
  if (pct == null) return AppColors.cyan;
  if (pct >= 0.9) return AppColors.healthRed;
  if (pct >= 0.75) return AppColors.healthYellow;
  return AppColors.cyan;
}
```

### 5. Add TOKEN USAGE row to DiagnosticsModal

In the expanded modal, add a row between VAD and RT:

```dart
_DiagRow(
  label: 'TOKENS',
  value: diag.tokenDisplay ?? '--',
  labelStyle: labelStyle,
  valueStyle: valueStyle.copyWith(color: _tokenColor),
),
```

### 6. Unit tests

Add to existing `acp_update_parser_test.dart`:
- `usage_update` with valid `used` and `size` → `AcpUsageUpdate`
- `usage_update` with missing `used` → null
- `usage_update` with non-int `used` → null
- `usage_update` with `size: 0` → percentage is 0.0

Add to `diagnostics_info_test.dart` (or create if needed):
- `tokenDisplay` formatting: `35K / 1M`
- `tokenPercentage` calculation
- `tokenPercentage` null when no data

## Not in scope

- Detailed token breakdown (input vs output tokens) — only total `used` vs `size`
- Historical usage tracking across sessions
- Token usage in voice mode (only flows through relay/chat mode currently)

## Relates to

- Task 038: Verbose ACP Tool Feedback (also extends AcpUpdateParser)
- Task 024: Diagnostics Panel — Live Pipeline Values (existing diagnostics surface)

## Acceptance criteria

- [ ] `AcpUsageUpdate` class added to sealed hierarchy
- [ ] `AcpUpdateParser.parse()` handles `usage_update` kind
- [ ] `DiagnosticsInfo` has `tokenUsed`, `tokenSize`, `tokenDisplay`, `tokenPercentage`
- [ ] `DiagnosticsBar` shows `TOK: 35K / 1M` metric with color thresholds
- [ ] Color: cyan below 75%, yellow 75-90%, red above 90%
- [ ] `DiagnosticsModal` shows TOKENS row
- [ ] Unit tests for parser, state model, and color threshold logic

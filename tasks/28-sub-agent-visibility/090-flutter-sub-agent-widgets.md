# TASK-090: Flutter Sub-Agent UI Widgets

**Epic:** 28 — Sub-Agent Visibility
**Status:** Not Started
**Depends On:** 089
**Blocked By:** 089

## Description

Build the Flutter UI widgets for sub-agent visibility: `SubAgentChip` (DiagnosticsBar indicator), `SubAgentCard` (per-agent detail row), and `SubAgentPanel` (bottom sheet). Wire the chip into `ConversationScreen`'s DiagnosticsBar trailing slot alongside the existing artifact button.

## Files

### Create

- `apps/mobile/lib/widgets/sub_agent_chip.dart` — Compact chip indicator
- `apps/mobile/lib/widgets/sub_agent_card.dart` — Per-agent detail card
- `apps/mobile/lib/widgets/sub_agent_panel.dart` — Bottom sheet with card list
- `apps/mobile/test/widgets/sub_agent_chip_test.dart` — Chip widget tests
- `apps/mobile/test/widgets/sub_agent_panel_test.dart` — Panel widget tests

### Modify

- `apps/mobile/lib/screens/conversation_screen.dart` — Compose chip + artifact button in DiagnosticsBar trailing slot

## Implementation Notes

### SubAgentChip (`sub_agent_chip.dart`)

Compact indicator that sits in the DiagnosticsBar trailing slot.

| State | Visual | Text |
|-------|--------|------|
| No agents | Hidden (return `SizedBox.shrink()`) | — |
| 1+ running | Pulsing green dot + count | `1 agent` / `3 agents` |
| 1+ errored | Pulsing red dot + count | `1 agent` / `3 agents` |
| All completed | Static green dot + count | `2 done` |

Chip fades out 30 seconds after all agents complete. Use `AnimatedOpacity` with a `Timer` that starts when `overallStatus` transitions to `completed`.

The pulsing dot animation should use `AnimationController` with a repeat cycle (similar to `AmberOrb` in `amber_orb.dart`). Green = `AppColors.green` or `Color(0xFF00FF41)`, Red = `AppColors.red` or `Color(0xFFFF3333)`.

On tap: call `showSubAgentPanel(context, subAgentService: service)`.

Text styling: use `AppTypography.monoXs` to match DiagnosticsBar aesthetic.

### SubAgentCard (`sub_agent_card.dart`)

Per-agent detail row within the panel.

```
+--------------------------------------+
| Fix login bug in auth.ts             |  <- task (1 line, ellipsis)
| STATUS: RUNNING  |  MODEL: sonnet    |  <- status + model
| ELAPSED: 45s     |  LAST: Reading... |  <- duration + last output
+--------------------------------------+
```

| Field | Source | Formatting |
|-------|--------|------------|
| Task | `agent.task` | Single line, overflow ellipsis |
| Status | `agent.status` | Uppercase. Green=running, cyan=completed, red=errored, gray=unknown |
| Model | `agent.model` | Strip `claude-` prefix (e.g. "sonnet-4-6") |
| Elapsed | `now - agent.startedAt` | Live-updating: `12s`, `2m 30s`, `1h 5m` |
| Last | `agent.lastOutput` | Single line, ellipsis, monospace |

Use the TUI styling from `tui_widgets.dart`. Card should have a subtle border (`Color(0xFF2D2D2D)`) matching the health panel style.

### SubAgentPanel (`sub_agent_panel.dart`)

Bottom sheet (55% screen height) matching the `HealthPanel` pattern from `health_panel.dart` (lines 74-84).

```dart
void showSubAgentPanel(
  BuildContext context, {
  required SubAgentService subAgentService,
}) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (context) => _SubAgentPanel(subAgentService: subAgentService),
  );
}
```

Follow the `_HealthPanel` pattern:
- `StatefulWidget` with listener setup in `initState`, cleanup in `dispose`
- Container with `Color(0xFF0D0D0D)` background, `BorderRadius.vertical(top: Radius.circular(20))`
- Header: `TuiHeader(label: 'SUB-AGENTS')` or styled `Text` matching health panel

**Sort order:** Running agents first (by `startedAt` ascending), then completed/errored (by `completedAt` descending).

**Empty state:** Center text "No active sub-agents." in `AppTypography.monoSm` with gray color.

**Live elapsed time:** Use a `Timer.periodic(Duration(seconds: 1), ...)` while the panel is open (same pattern as `_DiagnosticsModal._uptimeTimer` in `diagnostics_bar.dart`). Dispose the timer in `dispose()`.

### ConversationScreen integration (`conversation_screen.dart`)

Replace the current trailing widget (lines 96-111) with a composed `Row`:

```dart
DiagnosticsBar(
  // ... existing params ...
  trailing: _buildTrailingWidgets(state),
),

Widget? _buildTrailingWidgets(ConversationState state) {
  final chips = <Widget>[];

  if (state.artifacts.isNotEmpty) {
    chips.add(TuiButton(
      label: 'ARTIFACTS: ${state.artifacts.length}',
      onPressed: () => showArtifactsListModal(context, artifacts: state.artifacts),
    ));
  }

  // Listen to SubAgentService via ListenableBuilder or similar
  // Add SubAgentChip when agents present
  chips.add(SubAgentChip(service: _liveKitService.subAgentService));

  if (chips.isEmpty) return null;
  if (chips.length == 1) return chips.first;
  return Row(mainAxisSize: MainAxisSize.min, children: chips);
}
```

Use `ListenableBuilder` wrapping the `SubAgentService` to rebuild only when sub-agent state changes, avoiding unnecessary rebuilds of the entire screen.

### Completed agent rolloff (UI)

Completed agents remain visible in the panel for 60 seconds after `completedAt`. Use `AnimatedOpacity` to fade them out. If the panel is open when an agent completes, it stays visible until the panel closes or the 60-second timer expires.

## Tests

### Chip tests (`test/widgets/sub_agent_chip_test.dart`)

1. Hidden when no agents (renders SizedBox.shrink)
2. Shows count and green dot when agents are running
3. Shows count and red dot when agents have errors
4. Shows "done" text when all agents completed
5. Pulsing animation active when agents running
6. Tap opens SubAgentPanel

### Panel tests (`test/widgets/sub_agent_panel_test.dart`)

1. Renders cards for each agent
2. Running agents sorted before completed agents
3. Card displays task, status, model, elapsed, lastOutput
4. Status text colored correctly (green for running, etc.)
5. Model name strips `claude-` prefix
6. Empty state shown when no agents
7. Elapsed time format: `12s`, `2m 30s`, `1h 5m`
8. Panel matches 55% screen height

## Acceptance Criteria

- [ ] `SubAgentChip` appears in DiagnosticsBar when agents are present
- [ ] Chip shows correct count, dot color, and pulsing animation
- [ ] Chip coexists with artifact button in trailing slot
- [ ] Tap on chip opens SubAgentPanel bottom sheet
- [ ] Panel shows per-agent cards with task, status, model, elapsed, lastOutput
- [ ] Cards sorted: running first, then completed/errored
- [ ] Elapsed time updates live while panel is open
- [ ] Empty state displayed when no agents
- [ ] Chip fades out 30s after all agents complete
- [ ] Completed agents fade from panel after 60s
- [ ] All widget tests pass

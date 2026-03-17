# TASK-090: Flutter Sub-Agent UI Widgets

**Epic:** 28 — Sub-Agent Visibility
**Status:** Not Started
**Depends On:** TASK-089 (SubAgentService and data model)
**Blocked By:** TASK-089

## Description

Build the three UI widgets for sub-agent visibility: `SubAgentChip` (compact indicator in DiagnosticsBar), `SubAgentCard` (per-agent detail row), and `SubAgentPanel` (bottom sheet containing cards). Wire the chip into `ConversationScreen`'s `DiagnosticsBar` trailing slot alongside the existing artifact counter button.

## Files

### Create

- `apps/mobile/lib/widgets/sub_agent_chip.dart` — Compact chip widget for DiagnosticsBar trailing slot.
- `apps/mobile/lib/widgets/sub_agent_card.dart` — Per-agent detail card for the panel.
- `apps/mobile/lib/widgets/sub_agent_panel.dart` — Bottom sheet listing agent cards.
- `apps/mobile/test/widgets/sub_agent_chip_test.dart` — Widget tests for the chip.
- `apps/mobile/test/widgets/sub_agent_panel_test.dart` — Widget tests for the panel (includes card tests).

### Modify

- `apps/mobile/lib/screens/conversation_screen.dart` — Change the `DiagnosticsBar.trailing` to a `Row` that includes both the artifact button AND the sub-agent chip when agents are present.

## Implementation Notes

### SubAgentChip (`sub_agent_chip.dart`)

A compact indicator widget. It listens to `SubAgentService` and shows/hides based on agent state.

**Visual states:**

| State | Dot | Text | Animation |
|-------|-----|------|-----------|
| No agents | Hidden (widget not rendered) | -- | -- |
| 1+ running | `AppColors.healthGreen` | `"1 agent"` / `"3 agents"` | Pulsing dot (opacity 0.5-1.0, 1s period) |
| 1+ errored, rest done | `AppColors.healthRed` | `"1 agent"` / `"3 agents"` | Pulsing dot |
| All completed | `AppColors.healthGreen` | `"2 done"` | Static dot, fade out after 30s |

**Pulsing animation:** Use `AnimationController` with `CurvedAnimation(Curves.easeInOut)` driving opacity from 0.4 to 1.0. Period: 1 second. Similar pattern to what could be done with the health orb in `diagnostics_bar.dart`, but simpler -- just opacity on the dot.

**Fade-out:** When all agents complete, start a 30-second `Timer`. On expiry, animate the entire chip to opacity 0 over 500ms, then hide. Cancel the timer if new agents arrive.

**Tap action:** `onTap` opens `SubAgentPanel` as a bottom sheet.

**Style:** Use `AppTypography.statusMetric` for text, `AppColors.healthGreen`/`healthRed` for dot colors, matching the DiagnosticsBar aesthetic. The chip should be compact -- 8px dot, 6px gap, text, all wrapped in a `GestureDetector`. No border or background (it sits in the DiagnosticsBar's trailing row).

### SubAgentCard (`sub_agent_card.dart`)

A card widget displaying a single agent's details within the panel.

**Layout:**
```
+--------------------------------------+
| Fix login bug in auth.ts             |  <- task (1 line, ellipsis)
| STATUS: RUNNING  |  MODEL: sonnet    |  <- status + model
| ELAPSED: 45s     |  LAST: Reading... |  <- duration + last output
+--------------------------------------+
```

**Field formatting:**
- **Task:** `agent.task`, single line, `TextOverflow.ellipsis`, `AppTypography.body` with `AppColors.textPrimary`.
- **Status:** `agent.status.name.toUpperCase()`. Color: green=running, cyan=completed, red=errored, gray=unknown (use `AppColors.healthGreen`, `AppColors.cyan`, `AppColors.healthRed`, `AppColors.textSecondary`).
- **Model:** Strip `claude-` prefix (e.g., `"claude-sonnet-4-6"` -> `"sonnet-4-6"`). Use `AppColors.textSecondary`.
- **Elapsed:** Live-updating via timer (passed from panel). Format: `"12s"`, `"2m 30s"`, `"1h 5m"`. Use `agent.startedAt` and `DateTime.now()`.
- **Last output:** `agent.lastOutput`, single line, ellipsis, monospace (`AppTypography.statusMetric`).

**Card style:** Use `TuiCard` from `apps/mobile/lib/theme/tui_widgets.dart` with a colored left border based on status (green=running, cyan=completed, red=errored). This matches the existing artifact card and system event card patterns.

### SubAgentPanel (`sub_agent_panel.dart`)

A bottom sheet (55% screen height) listing agent cards, matching the `HealthPanel` pattern in `apps/mobile/lib/widgets/health_panel.dart`.

**Header:** `TuiHeader(label: 'SUB-AGENTS')` from `apps/mobile/lib/theme/tui_widgets.dart` (line 10). Uses amber color by default.

**Sort order:** Running agents first (sorted by `startedAt` ascending), then completed/errored (sorted by `completedAt` descending).

**Empty state:** Center-aligned text: `"No active sub-agents."` in `AppColors.textSecondary`.

**Live elapsed timer:** A 1-second `Timer.periodic` while the panel is open, following the pattern in `_DiagnosticsModalState` (`diagnostics_bar.dart` lines 218-229). The timer calls `setState(() {})` to trigger rebuilds so elapsed times update live.

**Panel style:** Match the `_HealthPanel` bottom sheet pattern:
```dart
showModalBottomSheet(
  context: context,
  isScrollControlled: true,
  backgroundColor: AppColors.surface,
  barrierColor: Colors.black54,
  shape: const Border(top: BorderSide(color: AppColors.amber, width: 2)),
  builder: (context) => SubAgentPanel(subAgentService: subAgentService),
);
```

The panel should listen to `SubAgentService` for live updates (same `addListener`/`removeListener` pattern as `_HealthPanelState` in `health_panel.dart` lines 98-111).

### ConversationScreen Trailing Slot (`conversation_screen.dart`)

Currently, the `DiagnosticsBar.trailing` is a single `TuiButton` for artifacts (lines 102-110):

```dart
trailing: state.artifacts.isNotEmpty
    ? TuiButton(
        label: 'ARTIFACTS: ${state.artifacts.length}',
        onPressed: () => showArtifactsListModal(...),
      )
    : null,
```

Change this to compose both the artifact button and the sub-agent chip in a `Row`:

```dart
trailing: _buildTrailing(context, state),
```

```dart
Widget? _buildTrailing(BuildContext context, ConversationState state) {
  final subAgentService = _liveKitService.subAgentService;
  final hasArtifacts = state.artifacts.isNotEmpty;

  // Listen to sub-agent changes for chip visibility
  return ListenableBuilder(
    listenable: subAgentService,
    builder: (context, _) {
      final hasAgents = subAgentService.hasAgents;
      if (!hasArtifacts && !hasAgents) return null; // or SizedBox.shrink()

      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (hasArtifacts)
            TuiButton(
              label: 'ARTIFACTS: ${state.artifacts.length}',
              onPressed: () => showArtifactsListModal(...),
            ),
          if (hasArtifacts && hasAgents)
            const SizedBox(width: AppSpacing.sm),
          if (hasAgents)
            SubAgentChip(
              service: subAgentService,
              onTap: () => _showSubAgentPanel(context, subAgentService),
            ),
        ],
      );
    },
  );
}
```

**Important:** The `DiagnosticsBar.trailing` parameter is typed as `Widget?`. If we return a `Row`, it works as-is because `Row` is a `Widget`. No change needed to `DiagnosticsBar` itself. However, since `ListenableBuilder` always returns a widget (not nullable), handle the empty case by returning `const SizedBox.shrink()` and adjust the `DiagnosticsBar` trailing conditional accordingly.

### Color Constants

All colors come from `AppColors` (`apps/mobile/lib/theme/app_colors.dart`):
- Running: `AppColors.healthGreen` (0xFF00FF00)
- Completed: `AppColors.cyan` (0xFF00E5FF)
- Errored: `AppColors.healthRed` (0xFFFF1744)
- Unknown: `AppColors.textSecondary` (0xFF888888)

### Elapsed Time Formatting

Helper function (can go in `sub_agent_card.dart` or a shared utility):
```dart
String formatElapsed(Duration duration) {
  if (duration.inHours > 0) {
    return '${duration.inHours}h ${duration.inMinutes.remainder(60)}m';
  }
  if (duration.inMinutes > 0) {
    return '${duration.inMinutes}m ${duration.inSeconds.remainder(60)}s';
  }
  return '${duration.inSeconds}s';
}
```

## Tests

### `apps/mobile/test/widgets/sub_agent_chip_test.dart`

Use `flutter_test` with `testWidgets`.

Test cases:
1. **Hidden when no agents** — chip is not rendered when `SubAgentService.hasAgents` is false.
2. **Shows count for running** — `"1 agent"` when one running, `"3 agents"` when three running.
3. **Shows "done" for completed** — `"2 done"` when all agents are completed.
4. **Green dot for running** — dot uses `AppColors.healthGreen`.
5. **Red dot for errored** — dot uses `AppColors.healthRed` when any agent errored.
6. **Tap opens panel** — tapping the chip calls the `onTap` callback.

### `apps/mobile/test/widgets/sub_agent_panel_test.dart`

Test cases:
1. **Empty state** — shows "No active sub-agents." when agents list is empty.
2. **Shows agent cards** — renders a card for each agent in the service.
3. **Sort order** — running agents appear before completed agents.
4. **Card fields** — each card displays task, status, model, and last output.
5. **Model formatting** — `"claude-sonnet-4-6"` displays as `"sonnet-4-6"`.
6. **Status color** — running status text is green, errored is red.
7. **Panel header** — `TuiHeader` with label "SUB-AGENTS" is rendered.
8. **Elapsed formatting** — `45s`, `2m 30s`, `1h 5m` formats are correct.

## Acceptance Criteria

- [ ] `SubAgentChip` shows pulsing dot + count when agents are present
- [ ] Chip displays correct color (green for running, red for errored)
- [ ] Chip fades out 30s after all agents complete
- [ ] Tapping chip opens `SubAgentPanel` bottom sheet
- [ ] `SubAgentPanel` shows `TuiHeader(label: 'SUB-AGENTS')`
- [ ] `SubAgentCard` displays task, status (colored), model (stripped prefix), elapsed, last output
- [ ] Elapsed time updates live (1s timer while panel is open)
- [ ] Cards sorted: running first (by startedAt), then completed/errored (by completedAt desc)
- [ ] Empty state shown when no agents
- [ ] Chip and artifact button coexist in DiagnosticsBar trailing `Row`
- [ ] All widget tests pass with `flutter test`

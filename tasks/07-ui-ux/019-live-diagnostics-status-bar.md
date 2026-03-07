# TASK-019: Live Diagnostics Status Bar

## Status
- **Status:** Not started
- **Priority:** Medium
- **Depends on:** 016 (TUI Design System)
- **Owner:** TBD
- **Created:** 2026-03-07

## Context
The new UI includes a diagnostics status bar below the waveform showing real-time voice pipeline metrics. This replaces the existing `StatusBar` widget (which shows agent actions like "reading", "searching") and the `_buildStatusIndicator` pill (which shows connection state text) with a single, data-rich, TUI-styled diagnostics row.

## Reference
- **Mockup:** [`mockups/chat-main-view.png`](./mockups/chat-main-view.png) (status bar visible below waveform)
- **Design philosophy:** See [EPIC.md — Design Philosophy](./EPIC.md#design-philosophy)

## Layout
```
[●] SYS: OK | VAD: 0.82 | RT: 12ms          [ ARTIFACTS: 2 ]
```

The entire status bar row should be **48dp height** minimum — this ensures both the left diagnostics area and the right artifacts button meet touch target requirements.

### Left Side: Diagnostics Summary (tappable)
The entire left area is a single `InkWell` / `GestureDetector` with `HitTestBehavior.opaque` — not just the tiny health orb.

- **Health orb** `[●]`: Small glowing dot (12dp visual), but the tappable zone is the full 48dp row height.
  - Green (`AppColors.healthGreen`): all systems nominal
  - Yellow (`AppColors.healthYellow`): degraded (high latency, reconnecting, partial failure)
  - Red (`AppColors.healthRed`): error state (agent disconnected, STT/TTS failure)
  - Glow effect: `Container` with `BoxShadow(blurRadius: 8, color: healthColor.withOpacity(0.6))`. Wrap in `RepaintBoundary` since glow color changes on state transitions.
- **SYS:** Overall system status (`OK`, `DEGRADED`, `ERROR`, `RECONNECTING`)
- **VAD:** Voice Activity Detection confidence (0.00-1.00)
- **RT:** Round-trip latency in ms
- All text: **12sp monospace**, `AppColors.cyan`, `FontWeight.w500`
- Pipe `|` separators in `AppColors.textSecondary`
- Spacing: `AppSpacing.xs` (4dp) between orb and text, `AppSpacing.sm` (8dp) around pipes

### Right Side: Artifacts Counter
- `[ ARTIFACTS: N ]` — `TuiButton` (see task 018, component 4)
- Separate touch target from the left diagnostics area, spaced >= 8dp apart

### Tappable: Expanded Diagnostics View (Bottom Sheet)
Tapping the left diagnostics area opens an expanded diagnostics view using `showModalBottomSheet`:

- `TuiModal` styling: amber border, dark background, sharp corners
- `TuiHeader`: `┌─ DIAGNOSTICS ─┐`
- Content — monospace key-value pairs, 12sp, `AppColors.cyan` labels with white values:

```
STT:         Deepgram ......... ACTIVE
TTS:         Google ........... ACTIVE
LLM:         OpenClaw ......... TTFT: 1.2s
CONNECTION:  Connected ........ Room: fletcher-1709
SESSION:     sk_owner_abc123
AGENT:       agent-worker-1
VAD:         0.82
RT:          12ms
UPTIME:      00:14:32
```

- Each row: minimum 32dp height (not interactive — display only, so 48dp not required)
- Close by dragging down or tapping outside
- `HapticFeedback.lightImpact()` on open

## Data Sources
- **VAD confidence:** From `Participant.audioLevel` (existing 100ms polling) or STT interim events
- **RT (round-trip):** From `TurnMetricsCollector` per-turn summaries (Epic 10). Show last completed turn's RT. Display `--` before first turn completes.
- **SYS status:** Computed from:
  - `ConversationStatus.connecting` / `reconnecting` → `RECONNECTING` (yellow)
  - `ConversationStatus.error` → `ERROR` (red)
  - Agent participant missing from room → `DEGRADED` (yellow)
  - RT > 2000ms → `DEGRADED` (yellow)
  - Otherwise → `OK` (green)
- **Health orb color:** Mirrors SYS status (green/yellow/red)
- **Expanded view data:** From `LiveKitService` state + `HealthService` state (both already available)

## Implementation Notes
- **Replaces** both the existing `StatusBar` widget (agent action text) and `_buildStatusIndicator` (connection state pill) in `conversation_screen.dart`
- Agent action events (`status` type from ganglia-events) move to the expanded diagnostics view — no longer shown inline
- Create a new `DiagnosticsBar` widget in `lib/widgets/diagnostics_bar.dart`
- Metrics update frequency: VAD updates at 100ms polling rate (existing), RT updates per-turn, SYS status updates on state change. Use `ChangeNotifier` listener pattern.
- Graceful fallback: show `--` for unavailable metrics (before first data arrives or on error)

## Acceptance Criteria
- [ ] Status bar row is >= 48dp height
- [ ] Left side displays real-time VAD confidence and round-trip latency in 12sp cyan monospace
- [ ] Health orb glows green/yellow/red based on computed system state
- [ ] SYS status reflects actual connection and pipeline health
- [ ] Left side is tappable (full row height hit zone) — opens expanded diagnostics bottom sheet
- [ ] Expanded view shows all pipeline details (STT, TTS, LLM, connection, session, agent, VAD, RT)
- [ ] Expanded view uses TUI styling (amber border, monospace, sharp corners)
- [ ] Right side shows `[ ARTIFACTS: N ]` button (implemented in task 018)
- [ ] Haptic feedback on tap to expand
- [ ] Health orb glow wrapped in `RepaintBoundary`
- [ ] Metrics show `--` / `N/A` before data is available (no blank or stale values)
- [ ] All text >= 12sp, all spacing on 4dp grid, all colors from `AppColors`
- [ ] Replaces existing `StatusBar` widget and `_buildStatusIndicator`

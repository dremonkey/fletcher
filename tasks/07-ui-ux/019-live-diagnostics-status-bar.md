# TASK-019: Live Diagnostics Status Bar

## Status
- **Status:** Not started
- **Priority:** Medium
- **Depends on:** 016 (TUI Design System)
- **Owner:** TBD
- **Created:** 2026-03-07

## Context
The new UI includes a diagnostics status bar below the waveform showing real-time voice pipeline metrics. This replaces the existing `StatusBar` widget (which shows agent actions like "reading", "searching") with a more data-rich, TUI-styled diagnostics display.

## Reference
- **Mockup:** [`mockups/chat-main-view.png`](./mockups/chat-main-view.png) (status bar visible below waveform)
- **Design philosophy:** See [EPIC.md — Design Philosophy](./EPIC.md#design-philosophy)

## Layout
```
[●] SYS: OK | VAD: 0.82 | RT: 12ms          [ ARTIFACTS: 2 ]
```

### Left Side: Diagnostics Summary
- **Health orb** `[●]`: Small glowing dot indicator
  - Green: all systems nominal
  - Yellow: degraded (high latency, reconnecting, partial failure)
  - Red: error state (agent disconnected, STT/TTS failure)
- **SYS:** Overall system status (`OK`, `DEGRADED`, `ERROR`)
- **VAD:** Voice Activity Detection confidence (0.00-1.00), real-time from STT/VAD events
- **RT:** Round-trip latency in ms, from `TurnMetricsCollector` (see Epic 10)
- Cyan monospace text on dark background
- Pipe `|` separators between metrics

### Right Side: Artifacts Counter
- `[ ARTIFACTS: N ]` button (see task 018)
- Amber border, monospace text

### Tappable: Expanded Diagnostics View
- Tapping the left-side diagnostics area opens an expanded diagnostics view
- Shows more detailed metrics:
  - STT provider + status
  - TTS provider + status
  - LLM backend + TTFT
  - Connection state (connected/reconnecting/disconnected)
  - Session ID
  - Agent participant identity
- Can be a bottom sheet or overlay in TUI style

## Data Sources
- **VAD confidence:** From `Participant.audioLevel` or STT interim events
- **RT (round-trip):** From `TurnMetricsCollector` per-turn summaries (Epic 10)
- **SYS status:** Derived from connection state, agent presence, error events
- **Health orb color:** Computed from SYS status + RT thresholds (e.g., RT > 2000ms → yellow, agent missing → red)

## Implementation Notes
- Replaces the existing `StatusBar` widget (which shows agent action text like "Searching...")
- Agent action events (`status` type from ganglia-events) can be shown in the expanded diagnostics view
- Metrics update frequency: VAD/RT update per-turn, SYS status updates on state change
- Health orb uses `Container` with `BoxShadow` for glow effect

## Acceptance Criteria
- [ ] Status bar displays real-time VAD confidence and round-trip latency
- [ ] Health orb glows green/yellow/red based on system state
- [ ] SYS status reflects actual connection and pipeline health
- [ ] Tapping opens an expanded diagnostics view with detailed metrics
- [ ] Cyan monospace text styling consistent with TUI theme
- [ ] Metrics update in real-time (not stale)
- [ ] Graceful fallback when metrics are unavailable (show `--` or `N/A`)

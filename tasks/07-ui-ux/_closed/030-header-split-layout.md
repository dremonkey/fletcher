# TASK-030: Split Header into Two-Column Layout

## Status
- **Status:** Complete
- **Priority:** High
- **Created:** 2026-03-08
- **Closed:** 2026-03-08
- **Phase:** Phase 1 — Header Refactor (Brutalist UI)

## Spec Reference
- [Brutalist UI Spec §1](../../docs/specs/brutalist-ui-spec.md) — Header Layout

## Problem

The current header uses a monolithic layout with a single audio visualizer. The brutalist UI redesign requires a two-column split: user histogram (left) and TTS toggle/status (right).

## Solution

1. Refactor the header container into a two-column flex layout
2. Move the existing `AudioVisualizer` component to the left column (user mic input only)
3. Reserve the right column for the `TTSToggle` component (TASK-031)

### Layout Target

```
┌─────────────────────────────────────────────────────────┐
│  [User Histogram]  │  [TTS Toggle/Status]              │
│  (Left)            │  (Right)                           │
└─────────────────────────────────────────────────────────┘
```

## Implementation Notes

- Header should be a flex container with `justify-content: space-between`
- Left column takes the existing `AudioVisualizer` with amber color palette (`#f59e0b`)
- Right column is initially a placeholder; wired up in TASK-031
- Background: `#1a1a2e` (dark slate)
- Ensure responsive — both columns should have `min-width` constraints

## Acceptance Criteria
- [x] Header is visually split into two columns
- [x] User audio histogram renders in the left column (cyan)
- [x] Right column has TTS toggle (wired in TASK-031/032)
- [x] No regression in existing audio visualization behavior

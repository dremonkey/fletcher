# 022: Macro Shortcut System (Quick Actions)

Implement a **3×3 Macro Cluster (Grid)** of customizable shortcut buttons to trigger specific skill-driven commands without voice input or typing.

## Problem Statement
Developing on the go with a voice interface can be high-friction for repetitive technical tasks (e.g., repo sweeps, bug logging, drafting specs). Users need a "fast path" to trigger common skills and system commands from the mobile terminal UI. The grid layout is optimized for **thumb-zone ergonomics** on mobile devices.

## Requirements
- **Macro Definition:** Configurable list of macros (short label, command, category).
- **Macro Cluster UI:** A **3×3 grid** of compact "Brutalist" buttons with short 3-4 character labels (e.g., `[PLS]`, `[BUG]`, `[SNP]`).
- **Position:** Anchored to the **bottom-right corner** by default (thumb-zone optimization for right-handed use).
- **Handedness Configuration:** User preference to mirror the cluster to the **bottom-left corner** for left-handed use.
- **Trigger Handling:** Tapping a macro sends a predefined "Command" to the agent.
- **Developer Macros:** Initial focus on dev-friendly macros (Pulse Check, Bug Log, Context Snapshot, Delegate to Claude).

## Shared Foundation: Slash Command Interceptor

The macro system shares infrastructure with EPIC-25 (Session Resumption). TASK-076 builds a **client-side slash command interceptor** in `sendTextMessage()` that routes `/`-prefixed input to a command registry instead of sending to the agent/relay. The macro grid buttons call the same registry — each macro is just a visual shortcut to a slash command.

```
  /sessions  ←── TASK-076/077 (EPIC-25)  ←── [SES] macro button
  /pulse     ←── Phase 4 (below)         ←── [PLS] macro button
  /bug       ←── Phase 4 (below)         ←── [BUG] macro button
```

**Dependency:** TASK-076 (slash command interceptor) should be built before or alongside Phase 1 below. The `MacroRegistry` wraps the same command registry with UI metadata (shortLabel, category, position).

## Implementation Plan

### Phase 1: Configuration & Model (Macro Registry)
- [ ] Define `Macro` model in Flutter: `id`, `label`, `shortLabel` (3-4 char brutalist style), `command`, `category`.
- [ ] Create a `MacroRegistry` service to manage the list of available macros (up to 9 for the grid).
- [ ] Wire `MacroRegistry` to the slash command registry (TASK-076) — each macro's `command` field maps to a registered slash command handler.
- [ ] Support loading macros from a JSON config (bundled or remote).
- [ ] Add `handedness` preference setting (`right` or `left`) to control cluster position.

### Phase 2: Macro Cluster Component
- [ ] Implement `TuiMacroCluster` widget:
    - [ ] **3×3 grid layout** with compact, tappable cells.
    - [ ] Brutalist aesthetic (square borders, monospace text, high contrast).
    - [ ] Short labels (3-4 chars max): `[PLS]`, `[BUG]`, `[SNP]`, `[DEL]`, etc.
    - [ ] Anchored to **bottom-right corner** by default.
    - [ ] Respects `handedness` preference to mirror to **bottom-left** for left-handed users.
- [ ] Integrate `TuiMacroCluster` into the `MainView` layout as a **floating overlay** in the thumb zone.

### Phase 3: Action Dispatcher
- [ ] Hook macro taps into the slash command registry (TASK-076) — same handler as typing the command.
- [ ] Ensure macros are treated as "Command" inputs (visible in chat transcript as user actions).
- [ ] (Optional) Add visual feedback on the button when a macro is running.

### Phase 4: Initial Macro Set (3×3 Grid)
- [ ] **[PLS]** Pulse Check: `/pulse` (Repo status sweep).
- [ ] **[BUG]** Bug Log: `/bug` (Start structured bug entry).
- [ ] **[SNP]** Context Snapshot: `/snapshot` (Summarize recent context into spec).
- [ ] **[DEL]** Delegate: `/delegate` (Prepare task for Claude Code).
- [ ] **[MEM]** Memory: `/memory` (Update memory/daily log).
- [ ] **[TSK]** Task: `/task` (Create new task file).
- [ ] **[GIT]** Git Status: `/git status` (Quick repo check).
- [ ] **[DOC]** Docs: `/docs` (Open relevant documentation).
- [ ] **[SES]** Sessions: `/sessions` (List past sessions — EPIC-25).
- [ ] **[HLP]** Help: `/help` (Show available commands).

## Success Criteria
- [ ] User can trigger a complex command with a single tap from the **3×3 grid**.
- [ ] Macros are clearly visible and accessible in the **thumb zone** (bottom-right or bottom-left based on handedness).
- [ ] Macro cluster does not obstruct the chat transcript or mic button.
- [ ] Handedness preference allows comfortable one-handed use for both left and right-handed users.

## References
- [Epic 15: Macro Shortcuts](./EPIC.md)
- [Epic 11: UI Redesign — TUI Brutalist](../07-ui-ux/EPIC.md) (inherits design system)
- BUG-010, BUG-011 (Orientation and state fixes for the new UI)

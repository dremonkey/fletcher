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

## Implementation Plan

### Phase 1: Configuration & Model (Macro Registry)
- [ ] Define `Macro` model in Flutter: `id`, `label`, `shortLabel` (3-4 char brutalist style), `command`, `category`.
- [ ] Create a `MacroRegistry` service to manage the list of available macros (up to 9 for the grid).
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
- [ ] Hook macro taps into `ChatService.sendMessage()`.
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
- [ ] **[HLP]** Help: `/help` (Show available commands).

## Success Criteria
- [ ] User can trigger a complex command with a single tap from the **3×3 grid**.
- [ ] Macros are clearly visible and accessible in the **thumb zone** (bottom-right or bottom-left based on handedness).
- [ ] Macro cluster does not obstruct the chat transcript or mic button.
- [ ] Handedness preference allows comfortable one-handed use for both left and right-handed users.

## References
- [Epic 11: UI Redesign — TUI Brutalist](./EPIC.md)
- BUG-010, BUG-011 (Orientation and state fixes for the new UI)

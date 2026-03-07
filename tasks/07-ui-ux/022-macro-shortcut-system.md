# 022: Macro Shortcut System (Quick Actions)

Implement a row of customizable "Macro" buttons (shortcuts) to trigger specific skill-driven commands without voice input or typing.

## Problem Statement
Developing on the go with a voice interface can be high-friction for repetitive technical tasks (e.g., repo sweeps, bug logging, drafting specs). Users need a "fast path" to trigger common skills and system commands from the mobile terminal UI.

## Requirements
- **Macro Definition:** Configurable list of macros (label, command, icon/F-key style).
- **Macro Bar UI:** A horizontally scrollable row of "Brutalist pills" or function-key style buttons (`[ F1: PULSE ]`) positioned above the chat input/mic area.
- **Trigger Handling:** Tapping a macro sends a predefined "Command" to the agent.
- **Developer Macros:** Initial focus on dev-friendly macros (Pulse Check, Bug Log, Context Snapshot, Delegate to Claude).

## Implementation Plan

### Phase 1: Configuration & Model (Macro Registry)
- [ ] Define `Macro` model in Flutter: `id`, `label`, `shortLabel` (for F-key style), `command`, `category`.
- [ ] Create a `MacroRegistry` service to manage the list of available macros.
- [ ] Support loading macros from a JSON config (bundled or remote).

### Phase 2: Macro Bar Component
- [ ] Implement `TuiMacroBar` widget:
    - [ ] Horizontally scrollable list.
    - [ ] Brutalist aesthetic (square borders, monospace text, high contrast).
    - [ ] Optional "F-key" prefixing (e.g., `[ F1: PULSE ]`, `[ F2: BUG ]`).
- [ ] Integrate `TuiMacroBar` into the `MainView` layout (above the Mic Button).

### Phase 3: Action Dispatcher
- [ ] Hook macro taps into `ChatService.sendMessage()`.
- [ ] Ensure macros are treated as "Command" inputs (visible in chat transcript as user actions).
- [ ] (Optional) Add visual feedback on the button when a macro is running.

### Phase 4: Initial Macro Set
- [ ] **Pulse Check:** `/pulse` (Repo status sweep).
- [ ] **Bug Log:** `/bug` (Start structured bug entry).
- [ ] **Context Snapshot:** `/snapshot` (Summarize recent context into spec).
- [ ] **Delegate:** `/delegate` (Prepare task for Claude Code).

## Success Criteria
- [ ] User can trigger a complex command with a single tap.
- [ ] Macros are clearly visible and accessible on the Brutalist UI.
- [ ] Macro bar does not obstruct the chat transcript or mic button.

## References
- [Epic 11: UI Redesign — TUI Brutalist](./EPIC.md)
- BUG-010, BUG-011 (Orientation and state fixes for the new UI)

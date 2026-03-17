# 022: Macro Shortcut System (Quick Actions)

Implement a **3×3 Macro Cluster (Grid)** of customizable shortcut buttons to trigger specific commands (Local or Agent-provided) without voice input or typing.

## Problem Statement
Developing on the go with a voice interface can be high-friction for repetitive technical tasks. Users need a "fast path" to trigger common skills and system commands from the mobile terminal UI. The grid layout is optimized for **thumb-zone ergonomics**.

## Requirements
- **Universal Slots:** 9 identical, fully remappable slots (0-8). No reserved system slots.
- **Dynamic Discovery:** Automatically populates the command pool from the Agent's `available_commands_update` (ACP).
- **Macro Cluster UI:** A **3×3 grid** of compact "Brutalist" buttons with short 3-4 character labels.
- **Position & Handedness:** Anchored to bottom-right by default; mirrorable to bottom-left via preference.
- **Command Picker:** A UI drawer/screen to browse all known commands (Name, Description, Hint) and bind them to a slot.

## Implementation Plan

### Phase 1: Configuration & Model (Macro Registry)
- [ ] Define `Macro` model: `id`, `label`, `shortLabel`, `command`.
- [ ] Create `MacroRegistry` service to manage the 9 slots and the command pool.
- [ ] Wire `RelayChatService` to update the command pool when `available_commands_update` arrives.

### Phase 2: Macro Cluster Component
- [ ] Implement `TuiMacroCluster` widget (3×3 grid).
- [ ] Integrate into `MainView` as a floating overlay in the thumb zone.
- [ ] Implement handedness mirroring.

### Phase 3: Command Picker UI (New)
- [ ] Build a "Macro Settings" or "Edit Grid" drawer.
- [ ] Show a unified list of all available commands (Local + Discovered Agent Commands).
- [ ] Support binding a command to a specific grid slot with a custom short label.

### Phase 4: Action Dispatcher
- [ ] Hook macro taps to send the `/command` text via `RelayChatService`.
- [ ] (Optional) Add visual feedback/haptics on tap.

## Success Criteria
- [ ] User can trigger a complex command with a single tap from the **3×3 grid**.
- [ ] Macros are clearly visible and accessible in the **thumb zone** (bottom-right or bottom-left based on handedness).
- [ ] Macro cluster does not obstruct the chat transcript or mic button.
- [ ] Handedness preference allows comfortable one-handed use for both left and right-handed users.

## References
- [Epic 15: Macro Shortcuts](./EPIC.md)
- [Epic 11: UI Redesign — TUI Brutalist](../07-ui-ux/EPIC.md) (inherits design system)
- BUG-010, BUG-011 (Orientation and state fixes for the new UI)

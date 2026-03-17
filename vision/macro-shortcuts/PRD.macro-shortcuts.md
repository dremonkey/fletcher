# PRD: Macro Shortcuts

**Status:** Draft
**Epic:** 15-macro-shortcuts
**Depends on:** Epic 17 (Text Input, complete), Epic 22 (Dual-Mode, in progress), Epic 25 (Session Resumption / CommandRegistry, complete)

---

## 1. Feature Scope

A 3x3 grid of customizable quick-action buttons ("macros") anchored to the thumb zone of Fletcher's mobile UI. Each button maps to a slash command (local or agent-provided) and executes it with a single tap. Users can rebind any slot via a picker UI.

### What this is:
- A fixed 9-slot shortcut grid for pre-bound commands
- A configuration UI (picker) for browsing and binding commands to slots
- A persistence layer for macro bindings
- Integration with ACP `available_commands_update` for dynamic command discovery

### What this is NOT:
- Not a command palette or search interface (no free-text command search)
- Not an automation system (no chaining, scheduling, or event-triggered macros)
- Not a plugin API (third-party macro packs are out of scope)
- Not a voice shortcut system (macros are touch-only; voice already handles arbitrary input)

---

## 2. User Stories

### Core

**US-1: One-tap command execution**
As a developer using Fletcher, I want to tap a button to send a known command to my agent so that I avoid dictating or typing repetitive instructions.

**US-2: Customize my grid**
As a developer, I want to rebind any macro slot to a different command so that my grid reflects my actual workflow, not a generic default.

**US-3: See what a macro does**
As a developer, I want each macro button to have a readable short label so that I know what it will do before I tap it.

### Discovery

**US-4: Browse available commands**
As a developer, I want to see all commands my agent supports (including ones I have not used before) so that I can bind new capabilities to my grid.

**US-5: Agent commands auto-populate**
As a developer, I want my macro command pool to update automatically when my agent gains new commands so that I do not need to manually track what is available.

### Ergonomics

**US-6: One-handed use**
As a developer holding my phone in one hand, I want the macro grid positioned in my thumb's natural reach zone so that I can tap macros without adjusting my grip.

**US-7: Left-hand support**
As a left-handed developer, I want to mirror the grid position to the bottom-left so that it is comfortable for my dominant hand.

---

## 3. Functional Requirements

### 3.1 Macro Model

A macro binding consists of:

| Field | Type | Description |
|-------|------|-------------|
| `slotIndex` | `int` (0-8) | Position in the 3x3 grid |
| `shortLabel` | `String` (3-4 chars) | Button face text, e.g. `BUG`, `MEM`, `TST` |
| `command` | `String` | The slash command to execute, e.g. `/memory search` |
| `args` | `String?` | Optional hardcoded arguments, nullable |
| `source` | `enum {local, agent}` | Whether this is a client-side or agent-discovered command |

All 9 slots are identical. There are no reserved system slots.

### 3.2 Macro Registry (Service)

- Manages the 9 macro slot bindings
- Maintains a command pool: union of local `CommandRegistry` entries and agent-discovered commands from `available_commands_update`
- Persists bindings to `SharedPreferences` (JSON-serialized list)
- Loads bindings on app start; applies defaults for any unbound slots on first launch
- Exposes a `ChangeNotifier` interface so widgets rebuild on binding changes

### 3.3 Command Pool

Two sources populate the pool:

**Local commands:** Read from `CommandRegistry.registeredCommands` at initialization. Currently only `/help`. As more local commands are added (Epic 25), they appear automatically.

**Agent commands:** Parsed from ACP `available_commands_update` session updates. The `AcpUpdateParser` currently returns `AcpNonContentUpdate('available_commands_update')` for these events. This must be upgraded to parse the `availableCommands` array and return a typed result containing:
- `name` (String) — the command name
- `description` (String) — human-readable description
- `hint` (String?) — argument hint, e.g. `[text]`

The command pool is the union of both sources. Agent commands may arrive asynchronously (on session init and when the agent's command set changes). The pool must handle duplicates by preferring agent-provided metadata over local stubs.

### 3.4 Grid UI (TuiMacroCluster)

- 3x3 grid of square buttons, each showing the `shortLabel` in monospace uppercase
- TUI Brutalist aesthetic: square borders, high contrast, `AppColors.amber` on `AppColors.background`
- Positioned as a floating overlay in the thumb zone (bottom-right by default)
- Must not obscure the mic button (`VoiceControlBar`) or block the last 2-3 lines of chat transcript
- Tapping a filled slot executes the bound command
- Tapping an empty slot opens the picker for that slot
- Visual feedback on tap: brief invert or flash (no haptics in MVP — add in polish phase)

**Sizing constraints:**
- Minimum button size: 44x44dp (Apple HIG / Material minimum touch target)
- Maximum grid footprint: 144x144dp (3 x 48dp) including gaps
- The grid must be testable on a 360dp-wide device (smallest common Android width)

### 3.5 Handedness

- A `handedness` preference (`right` | `left`) controls grid position
- `right` (default): grid anchored to bottom-right
- `left`: grid anchored to bottom-left
- Persisted in `SharedPreferences`
- Changeable via a local slash command (`/handedness toggle`) or a setting in the picker UI

### 3.6 Command Picker

- Triggered by long-press on any macro slot, or an "Edit" button on the grid
- Displays a scrollable list of all commands in the pool
- Each row shows: command name, description, hint (if present), source badge (local vs agent)
- Tapping a command assigns it to the target slot
- After selection, prompts for a short label (pre-filled with auto-derived abbreviation)
- Auto-derivation: first 3 consonants of the command name, uppercased (e.g., `memory` -> `MEM`, `buglog` -> `BGL`). User can override.
- "Clear slot" option to unbind a macro
- Follows TUI Brutalist aesthetic (monospace, high contrast, `TuiCard` containers)

### 3.7 Action Dispatcher

When a macro is tapped:

1. Resolve the full command string: `command` + `args` (if present)
2. If the command starts with `/` and matches `CommandRegistry`, dispatch locally (same path as typed slash commands)
3. Otherwise, send as a text prompt via `RelayChatService.sendPrompt()` (same path as typed text input)
4. The chat transcript shows the command as a user message (same as typed input)
5. Agent response streams back via the normal `RelayChatEvent` flow

This means macros work in both voice mode (routed through the voice agent's text_message handler) and text/chat mode (routed through the relay). The dispatcher does not need to know which mode is active — it uses the same `sendTextMessage` path as the text input bar.

---

## 4. Non-Functional Requirements

### 4.1 Performance
- Macro tap to command dispatch: < 100ms (local processing only; network latency is outside our control)
- Grid render: no jank on 60fps devices; grid is static content, not animated
- Picker list render: smooth scroll for up to 50 commands (the likely upper bound for an OpenClaw agent)

### 4.2 Accessibility
- Buttons meet 44x44dp minimum touch target (WCAG 2.5.5)
- Labels are high-contrast (amber on near-black, same as existing TUI theme)
- Screen reader: each button announces its full command name (not just the abbreviation)
- Picker rows have sufficient contrast and spacing for readability

### 4.3 Persistence
- Macro bindings survive app restart, room disconnect, and room transition
- Bindings are device-local (no sync across devices in this phase)
- Corrupted or missing persistence falls back to default bindings silently

### 4.4 Resilience
- If the agent has not yet sent `available_commands_update`, agent-sourced macros still execute (they are just text sent to the agent — they do not require client-side validation)
- If a command fails (unknown command, agent error), the error surfaces in the chat transcript like any other error — the macro grid itself does not show error state

---

## 5. Edge Cases and Constraints

### 5.1 Commands with Required Arguments
Some commands require arguments (e.g., `/memory search <query>`). Three strategies, in order of implementation priority:

1. **Hardcoded args** (MVP): The macro stores both command and args. Tap sends the full string. Good for fixed queries ("always search for project goals").
2. **No args** (MVP): The macro sends just the command. If the agent needs args, it asks via the normal conversation flow. Works naturally for conversational agents.
3. **Prompt on tap** (Post-MVP): After tap, a mini text field appears for the user to enter args before dispatch. More complex UI, defer unless user feedback demands it.

### 5.2 Agent Disconnect
When the agent is absent (hold mode, between dispatches), macros that route through `sendPrompt` will trigger agent dispatch via `AgentPresenceService` (same as typing text). The macro tap effectively acts as a "wake" signal.

### 5.3 Simultaneous Prompt
If a prompt is already in-flight (`RelayChatService.isBusy`), tapping a macro should either queue the command (simple) or show a brief "busy" indicator and drop the tap (simpler). MVP: drop the tap with a brief visual indication (button does not respond).

### 5.4 Grid Visibility vs. Screen Space
On small screens (< 400dp width or < 700dp height), the 3x3 grid may consume too much space. Options:
- **Collapsible** (recommended): a toggle button (e.g., `[>>>]`) expands/collapses the grid. Collapsed state shows only the toggle. Expanded state overlays the transcript.
- **Scrollable row**: collapse the 3x3 grid to a single scrollable row of 9 buttons. Loses the spatial memory advantage.

MVP should ship with the collapsible approach. Default to expanded on first launch, respect the user's last toggle state.

### 5.5 Default Macro Set
The initial 9 macros should be curated for developer workflows with OpenClaw. Suggested defaults (pending validation against actual OpenClaw command list):

| Slot | Label | Command | Rationale |
|------|-------|---------|-----------|
| 0 | `HLP` | `/help` | Orientation — always available |
| 1 | `MEM` | `/memory` | Check/update long-term memory |
| 2 | `BUG` | `check the bug log for open issues` | Common dev workflow |
| 3 | `TST` | `run the test suite` | Common dev workflow |
| 4 | `SUM` | `summarize what we've done this session` | Session awareness |
| 5 | `CTX` | `what files are you looking at?` | Context verification |
| 6 | `GIT` | `show me the git status` | Common dev workflow |
| 7 | `UND` | `undo the last change` | Quick reversal |
| 8 | `PLN` | `what's the plan?` | Task/plan check |

These defaults are best guesses. They should be revised after observing real OpenClaw `available_commands_update` payloads and actual developer usage patterns. Some of these (slots 2-8) are natural language prompts, not slash commands — that is intentional. The macro system does not care whether the string is a `/command` or plain text.

---

## 6. Out of Scope

| Feature | Rationale |
|---------|-----------|
| Macro chaining (run A then B) | Automation layer, not a shortcut system |
| Conditional macros (if X then Y) | Same — automation, not shortcuts |
| Macro sharing / import-export | No multi-device story yet; revisit after Sovereign Pairing |
| Voice-activated macros ("run macro 3") | Voice already handles arbitrary commands; macros are touch-only |
| Macro analytics / usage tracking | No telemetry infrastructure; defer to metrics epic |
| Custom icons per macro | Brutalist aesthetic uses text labels; icons add visual complexity |
| More than 9 slots | 9 is the sweet spot for thumb-zone spatial memory; more slots need pagination or search, which defeats the purpose |
| Macro groups / pages | Same reasoning — keep it simple, one grid |
| Agent-pushed macro bindings | The agent should not rearrange the user's grid. Discovery yes, binding no. |

---

## 7. Dependencies

| Dependency | Status | Impact |
|------------|--------|--------|
| `CommandRegistry` (Epic 25, TASK-076) | Complete | Provides local command dispatch and `/help` |
| `RelayChatService` (Epic 22) | Complete | Provides `sendPrompt()` for command execution |
| `AcpUpdateParser` (Epic 22) | Complete but needs extension | Must parse `available_commands_update` payload (currently returns `AcpNonContentUpdate`) |
| `VoiceControlBar` layout (Epic 11) | Complete | Macro grid must coexist without overlap |
| TUI Brutalist design system (TASK-016) | Complete | `AppColors`, `AppTypography`, `TuiButton`, `TuiCard` |
| `SharedPreferences` | In use | Persistence for macro bindings |
| `available_commands_update` from OpenClaw | Shipping (observed in field tests) | Agent command pool population |

No blocking dependencies. The `AcpUpdateParser` extension is the only code change outside the macro system itself, and it is straightforward (parse a JSON array that is already arriving).

---

## 8. Phasing Recommendation

### Phase 1: Model + Registry + Defaults (1-2 days)
- `Macro` model class
- `MacroRegistry` service with `SharedPreferences` persistence
- Default macro set (hardcoded for now)
- Unit tests for registry CRUD and persistence round-trip

### Phase 2: Grid UI (2-3 days)
- `TuiMacroCluster` widget (3x3 grid)
- Integration into `ConversationScreen` as floating overlay
- Collapse/expand toggle
- Handedness positioning
- Tap handler wired to action dispatcher
- Widget tests for layout and tap behavior

### Phase 3: Action Dispatcher (1 day)
- Route macro taps through `CommandRegistry` (for `/` commands) or `sendTextMessage` (for plain text)
- Handle busy state (drop tap when prompt in-flight)
- Integration test: tap macro -> command appears in chat transcript

### Phase 4: ACP Command Discovery (1-2 days)
- Extend `AcpUpdateParser` to parse `available_commands_update` into a typed `AcpAvailableCommandsUpdate` result
- Wire `RelayChatService` to forward parsed commands to `MacroRegistry` command pool
- Unit tests for parser extension and pool update

### Phase 5: Picker UI (2-3 days)
- Edit mode trigger (long-press or edit button)
- Command list with name, description, hint, source badge
- Slot binding with short label prompt (auto-derived + editable)
- Clear slot action
- Widget tests

### Total estimate: 7-11 days of focused work.

**Recommendation:** Ship Phases 1-3 as a usable MVP. The grid works with hardcoded defaults and local commands. Phase 4-5 (dynamic discovery + picker) can follow as a fast-follow. This gets the feature in users' hands early — if nobody uses the hardcoded grid, the picker UI is wasted work.

---

## 9. Open Design Decisions

| Decision | Options | Recommendation |
|----------|---------|----------------|
| Grid layout strategy | Floating overlay vs. layout Column child | Floating overlay (Positioned in Stack). Avoids reflowing the entire screen when grid expands. |
| Collapse default state | Expanded vs. collapsed on first launch | Expanded. The user needs to see the grid exists. Collapse after first interaction if desired. |
| Edit mode trigger | Long-press vs. dedicated edit button vs. both | Both. Long-press is discoverable for power users; edit button (small `[EDT]` below grid) catches everyone else. |
| Argument handling (MVP) | Hardcoded vs. no-args vs. prompt | No-args for MVP. Let the agent ask if it needs them. Simpler UX, and conversational agents handle this naturally. |
| Busy state behavior | Queue vs. drop | Drop with visual feedback. Queuing adds complexity and user confusion ("why did two commands run?"). |

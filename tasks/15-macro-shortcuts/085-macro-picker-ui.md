# TASK-085: Macro Command Picker UI

Build the UI for binding slash commands to the 3×3 macro grid slots.

## Requirements
1. **Trigger:** Provide a way to enter "Edit Mode" for the macro grid (e.g., long-press a slot or an "Edit" button).
2. **Command Pool:** Display a list of all available commands:
   - **Local Commands:** Hardcoded client-side commands (e.g., `/help`, `/handedness`).
   - **Agent Commands:** Commands discovered dynamically via ACP `available_commands_update`.
3. **Information Density:** For each command in the list, show:
   - Name (e.g., `/memory`)
   - Description (e.g., "Update long-term memory")
   - Hint (if provided, e.g., "[text]")
4. **Binding Logic:**
   - Tap a command in the list to assign it to the active grid slot.
   - Prompt user for a **Short Label** (3-4 characters, e.g., "MEM") if not automatically derived.
5. **Aesthetic:** Follow the "Brutalist" TUI design system (square borders, monospace fonts, high contrast).

## Success Criteria
- [ ] User can open the picker and see a list of both local and agent-provided commands.
- [ ] Selecting a command successfully updates the `MacroRegistry` for the target slot.
- [ ] The grid UI updates immediately to reflect the new binding.
- [ ] Command descriptions are readable to help users choose.

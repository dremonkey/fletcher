# Epic: Macro Shortcut System (15-macro-shortcuts)

Customizable quick-action buttons for triggering skill-driven commands without voice input or typing. Optimized for thumb-zone ergonomics on mobile devices.

## Design Direction
- **3×3 Macro Grid** — compact brutalist buttons with 3-4 char labels (`[PLS]`, `[BUG]`, `[SNP]`)
- **Thumb-zone anchored** — bottom-right by default, mirrorable for left-handed use
- **Command dispatch** — tapping a macro sends a predefined command to the agent via ChatService
- **Developer-first** — initial macro set focuses on dev workflows (repo sweep, bug log, context snapshot, delegation)

## Tasks
- [ ] 022: Macro Shortcut System — model, registry, TuiMacroCluster widget, action dispatcher, initial macro set

## References
- Inherits TUI Brutalist design system from [Epic 11 (07-ui-ux)](../07-ui-ux/EPIC.md)
- Depends on: Task 016 (TUI Design System), Task 017 (Chat-First Main View)

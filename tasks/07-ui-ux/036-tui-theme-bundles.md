# Task: TUI Theme Bundles (Solarized, Gruvbox, Nord)

Implement a theme system for the Brutalist TUI with a curated set of classic terminal-inspired color palettes.

## Context
As a "High-Speed Instrument," Fletcher should offer the same level of customization as a professional terminal emulator. Curating a set of iconic high-contrast and retro themes will enhance the "Custom Instrument" feel and provide better accessibility for different lighting conditions.

## Requirements
- **Solarized (Light & Dark):** Precision-contrast palette based on Ethan Schoonover's work.
- **Gruvbox:** Warm, retro mid-century tones.
- **Nord:** Crisp arctic blues for a modern clean look.
- **Monokai:** Classic high-vibrancy "hacker" theme.
- **IBM 3270:** Mainframe-inspired "high-voltage green" on pure black.

## Implementation Details
- Define `TuiTheme` data model in Flutter.
- Map theme colors to existing `AppColors` semantic keys (Background, Foreground, Primary, Secondary, Cyan, Amber).
- Add a Theme Selection menu in the settings drawer.
- Ensure the Amber Orb visualizer adjusts its "glow" and "pulse" colors to remain legible across all themes.

## Status
- [ ] Research specific hex codes for curated themes.
- [ ] Implement `ThemeService` and persistence.
- [ ] Build Theme Selection UI.
- [ ] Verify accessibility across light and dark variants.

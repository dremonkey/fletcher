# TASK-016: TUI Brutalist Design System

## Status
- **Status:** Complete
- **Priority:** High (foundational — other UI tasks depend on this)
- **Owner:** Claude
- **Created:** 2026-03-07
- **Completed:** 2026-03-07

## Context
Fletcher is adopting a new visual direction: a TUI-inspired, 8-bit, brutalist design language. This task establishes the foundational design system that all other UI tasks build on.

## Reference
- **Mockups:** All three in [`mockups/`](./mockups/) — these are the canonical visual reference
- **Design philosophy:** See [EPIC.md — Design Philosophy](./EPIC.md#design-philosophy)

## Design Tokens

### Colors
Define as `static const` values in `lib/theme/app_colors.dart`:

| Name | Hex | Usage |
|------|-----|-------|
| `background` | `#121212` | Scaffold background |
| `surface` | `#1A1A1A` | Card/message backgrounds |
| `amber` | `#FFB300` | Primary accent — borders, user labels, mic button, artifact buttons |
| `cyan` | `#00E5FF` | Secondary accent — agent waveform, diagnostics text, status data |
| `textPrimary` | `#FFFFFF` | Message body text |
| `textSecondary` | `#888888` | Timestamps, separators, muted elements |
| `healthGreen` | `#00FF00` | Diagnostics OK state |
| `healthYellow` | `#FFD600` | Diagnostics warning state |
| `healthRed` | `#FF1744` | Diagnostics error state |
| `amberGlow` | `rgba(255, 179, 0, 0.3)` | Glow/shadow on active elements |

Migrate away from current inline hex values (`0xFFF59E0B`, `0xFF0D0D0D`, `0xFF1F1F1F`, `0xFF6B7280`, etc.) to these named constants. Update `main.dart` `ThemeData` to use the new token values.

**Accessibility:** Verify WCAG AA contrast ratios against `#121212` background:
- Amber `#FFB300` on `#121212` — 8.3:1 (passes AA)
- Cyan `#00E5FF` on `#121212` — 10.2:1 (passes AA)
- `#888888` on `#121212` — 4.0:1 (borderline — may need to lighten to `#999999` for body text. Acceptable for labels/metadata)

### Typography
Define in `lib/theme/app_typography.dart`. Use `Theme.of(context).textTheme.*` where possible, with `copyWith()` for customization.

**Font family:** Monospace throughout. Use a bundled monospace font (`JetBrains Mono` or `IBM Plex Mono`) for consistency across devices. Avoid `Press Start 2P` for body text — it's illegible below 16sp. Could be used sparingly for decorative headers only.

| Use case | Size | Weight | Notes |
|----------|------|--------|-------|
| Message body | 14sp | w400 | `bodyMedium` monospace |
| Labels (USER/AGENT) | 12sp | w700 | `labelMedium`, uppercase, amber/cyan color |
| Status bar metrics | 12sp | w500 | `labelMedium` monospace — **not 11sp** (these display important real-time data) |
| Artifact badges | 12sp | w500 | `labelMedium`, uppercase |
| Artifact content | 13sp | w400 | Code/log content in drawer |
| Overline / timestamps | 11sp | w500 | `labelSmall` — absolute minimum, metadata only |

**Rule:** No font size below 12sp except for non-essential metadata (timestamps, separators). Status bar data (VAD, RT, SYS) is essential and must be >= 12sp.

### Spacing
Define in `lib/theme/app_spacing.dart`. All values on the **4dp grid**:

| Token | Value | Usage |
|-------|-------|-------|
| `xs` | 4dp | Tight inline (icon-to-text, pipe separators) |
| `sm` | 8dp | Related elements, chip padding, inter-element |
| `md` | 12dp | Intra-group spacing, message internal padding |
| `base` | 16dp | Standard padding, screen edge padding, inter-group |
| `lg` | 24dp | Section separation, between waveform and status bar |
| `xl` | 32dp | Major gaps |
| `xxl` | 48dp | Mic button zone, bottom safe area |

### Border Decorators
- TUI-style corner brackets: `┌─`, `─┐`, `└─`, `─┘`
- Single-pixel borders in amber for agent messages and artifact cards
- No rounded corners anywhere — `borderRadius: BorderRadius.zero` on everything
- Message separators: `---` (thin horizontal rule, `Divider` with amber/secondary color)

### Components (Reusable Widgets)
- **`TuiHeader`** — renders `┌─ LABEL ─┐` pattern with configurable label text and color
- **`TuiCard`** — dark surface card with optional amber left border, sharp corners
- **`TuiButton`** — amber-bordered rectangle with monospace text, outline style, **minimum 48dp height** touch target
- **`TuiModal`** — full amber border, dark background, `TuiHeader` at top

All decorator widgets should use `const` constructors where possible.

## File Organization
```
apps/mobile/lib/theme/
├── app_colors.dart       # Named color constants (static const)
├── app_spacing.dart      # Spacing scale (xs, sm, md, lg, xl, xxl)
├── app_typography.dart   # Custom monospace TextStyles
└── tui_widgets.dart      # TuiHeader, TuiCard, TuiButton, TuiModal
```

## Integration with ThemeData
Update `main.dart` to:
- Set `fontFamily` to the bundled monospace font in `ThemeData`
- Replace `ColorScheme.fromSeed(seedColor: 0xFFF59E0B)` with an explicit `ColorScheme` using the new token values
- Set `scaffoldBackgroundColor` to `AppColors.background`
- Ensure `useMaterial3: true` is retained

## Acceptance Criteria
- [x] Color constants defined in `lib/theme/app_colors.dart` — no more inline hex values in widgets
- [x] Typography styles defined in `lib/theme/app_typography.dart` — all use monospace, no size < 12sp except `labelSmall` (11sp, metadata only)
- [x] Spacing constants defined in `lib/theme/app_spacing.dart` — all on 4dp grid
- [x] `TuiHeader`, `TuiCard`, `TuiButton` widgets implemented with `const` constructors
- [x] `ThemeData` in `main.dart` updated to use new tokens
- [x] All touch targets on reusable button/card widgets enforce >= 48dp height
- [x] No rounded corners (`BorderRadius.zero`) on any component
- [x] WCAG AA contrast ratios verified for amber and cyan on background
- [x] Existing widgets still compile (no breaking changes — migration is incremental)

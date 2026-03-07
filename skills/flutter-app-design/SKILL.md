---
name: flutter-app-design
description: Use this skill when the user asks to design, build, or refactor Flutter UI components, screens, or full applications. It enforces Flutter best practices, widget architecture, responsive design, and clean state management.
argument-hint: <component or screen description>
---

# Flutter App Design Guidelines

Act as an expert Flutter UI/UX developer and software architect. When generating or modifying Flutter code, strictly adhere to the following principles.

## Project Context

Before writing any code, read these files to understand the current app:
- `apps/mobile/lib/main.dart` — Theme setup, app entry
- `apps/mobile/lib/screens/conversation_screen.dart` — Main layout
- `apps/mobile/lib/models/conversation_state.dart` — State models

This project uses:
- **Material 3** with a dark amber theme (`ColorScheme.fromSeed(seedColor: 0xFFF59E0B, brightness: Brightness.dark)`)
- **ChangeNotifier** for state management (no Riverpod/Bloc/Provider)
- **Voice-first UI** — minimal chrome, animation-heavy, single-screen focused
- **Stack-based layout** with `Positioned` children inside `SafeArea`

---

## 1. Touch Targets & Hit Zones

**Minimum touch target: 48x48 logical pixels** (Material 3 guideline, Android accessibility requirement).

| Element | Min Size | Recommended | Notes |
|---------|----------|-------------|-------|
| Icon buttons | 48x48 | 48x48 | Use `IconButton` which enforces this by default |
| Text buttons | 48 height | 48 height, 88+ width | Ensure horizontal padding gives enough width |
| FABs | 56x56 | 56x56 | Standard Material 3 FAB |
| Chips / toggles | 48 height | 48 height | Wrap small visuals with `SizedBox` or `ConstrainedBox` |
| List items | 48 height | 56-72 height | One-line=56, two-line=72, three-line=88 |
| Bottom sheet handles | 48 height | 48 height drag zone | Even if the visual handle is 4px tall |

**Rules:**
- Never make interactive elements smaller than 48x48 dp, even if the visual element is smaller. Use `padding` or `SizedBox` to expand the hit zone.
- Space interactive elements at least **8dp apart** to prevent mis-taps.
- For custom `GestureDetector` / `InkWell` widgets, explicitly set `behavior: HitTestBehavior.opaque` to ensure the full area is tappable.
- Prefer `InkWell` or `InkResponse` over raw `GestureDetector` for Material feedback.

```dart
// BAD — tiny hit zone
GestureDetector(
  onTap: onClose,
  child: Icon(Icons.close, size: 16),
)

// GOOD — proper hit zone with feedback
IconButton(
  onPressed: onClose,
  icon: const Icon(Icons.close, size: 20),
  // IconButton provides 48x48 hit zone by default
)
```

---

## 2. Typography & Font Sizes

**Minimum readable font size: 12sp.** Never go below 11sp for any text.

| Use Case | Size | Weight | Material 3 Style |
|----------|------|--------|-------------------|
| Hero / display | 32-57sp | w400 | `displayMedium` / `displaySmall` |
| Section headers | 22-24sp | w400-w500 | `headlineSmall` / `titleLarge` |
| Card titles | 16sp | w500 | `titleMedium` |
| Body text | 14sp | w400 | `bodyMedium` |
| Captions / labels | 12sp | w500 | `labelMedium` |
| Overline / metadata | 11sp | w500 | `labelSmall` |
| Status text (min) | 12sp | w500 | Custom — never smaller |

**Rules:**
- Always use `Theme.of(context).textTheme.*` instead of inline `TextStyle(fontSize: ...)` for standard text styles.
- For custom sizes, derive from the theme: `Theme.of(context).textTheme.bodyMedium!.copyWith(...)`.
- Use `MediaQuery.textScaleFactorOf(context)` awareness — avoid `overflow: TextOverflow.clip` on scaled text.
- Prefer `Text.rich()` with `TextSpan` for mixed-style text instead of multiple `Text` widgets in a `Row`.

```dart
// BAD — hardcoded, unscalable
Text('Status', style: TextStyle(fontSize: 11, color: Color(0xFF9CA3AF)))

// GOOD — theme-based
Text('Status', style: Theme.of(context).textTheme.labelSmall?.copyWith(
  color: Theme.of(context).colorScheme.onSurfaceVariant,
))
```

---

## 3. Spacing & Layout

Use a **4dp base grid**. All spacing should be a multiple of 4.

| Token | Value | Use Case |
|-------|-------|----------|
| `xs` | 4 | Tight inline spacing (icon-to-text) |
| `sm` | 8 | Related elements, chip padding |
| `md` | 12 | Intra-group spacing |
| `base` | 16 | Standard padding, inter-group spacing |
| `lg` | 24 | Section separation |
| `xl` | 32 | Major section gaps |
| `xxl` | 48 | Screen edge padding (top/bottom safe areas) |

**Rules:**
- Always use `SafeArea` as the outermost layout wrapper. This project already does this.
- Use `EdgeInsets.symmetric()` or `EdgeInsets.only()` — avoid `EdgeInsets.all()` when vertical and horizontal padding differ.
- Prefer `SizedBox(height: N)` for vertical spacing between widgets over `Padding`. It's more readable and explicit.
- Use `Gap` from the `gap` package if available, otherwise `SizedBox`.
- Never hardcode spacing that duplicates system insets — use `MediaQuery.of(context).padding` or `SafeArea`.

**Whitespace principles:**
- **Breathing room:** Content should never touch container edges. Minimum 16dp padding from screen edges.
- **Visual grouping:** Related items get 8dp spacing; unrelated sections get 24dp+ spacing.
- **Density balance:** Voice-first UI should feel open — prefer generous spacing. This isn't a data-dense dashboard.

```dart
// BAD — inconsistent, non-grid spacing
Padding(padding: EdgeInsets.fromLTRB(15, 11, 15, 7), ...)

// GOOD — grid-aligned, readable
Padding(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12), ...)
```

---

## 4. Widget Architecture

### Composition over Inheritance
- Break complex UIs into small, focused widgets. If a `build` method exceeds ~50 lines, extract sub-widgets.
- Prefer **private stateless widgets** (e.g., `class _StatusRow extends StatelessWidget`) for layout fragments.
- Avoid deeply nested widget trees — extract when nesting exceeds 5-6 levels.

### Const Constructors
- Always use `const` constructors for widgets that accept only compile-time constant parameters.
- Mark widget instances as `const` at call sites: `const SizedBox(height: 16)`, `const Icon(Icons.mic)`.

### Widget Separation
- **UI widgets** should only consume data and emit callbacks. No business logic in `build`.
- **Services** (like `LiveKitService`) own the logic and expose state via `ChangeNotifier`.
- Widgets listen via `addListener` in `initState()` and `removeListener` in `dispose()`.

```dart
// This project's pattern:
class MyWidget extends StatefulWidget { ... }

class _MyWidgetState extends State<MyWidget> {
  late final LiveKitService _service;

  @override
  void initState() {
    super.initState();
    _service = /* obtain service */;
    _service.addListener(_onChanged);
  }

  @override
  void dispose() {
    _service.removeListener(_onChanged);
    super.dispose();
  }

  void _onChanged() => setState(() {});

  @override
  Widget build(BuildContext context) { ... }
}
```

---

## 5. State Management (ChangeNotifier)

This project uses vanilla Flutter state management. Follow these rules:

- **ChangeNotifier** for service-level state (`LiveKitService`, `HealthService`).
- **StatefulWidget** for local UI state (animations, scroll controllers, focus nodes).
- **StatelessWidget** for pure presentation that receives data via constructor.
- Call `notifyListeners()` only when state actually changes — avoid unnecessary rebuilds.
- Use immutable state models with `copyWith()` (see `ConversationState`).
- Never call `setState()` or `notifyListeners()` after `dispose()` — guard with a mounted check.

```dart
void _onChanged() {
  if (mounted) setState(() {});
}
```

---

## 6. Theming & Colors

### Current Palette
| Name | Hex | Usage |
|------|-----|-------|
| Amber (primary) | `0xFFF59E0B` | Brand, user actions, orb |
| Near Black (bg) | `0xFF0D0D0D` | Scaffold background |
| Dark Surface | `0xFF1F1F1F` | Cards, bottom sheets |
| Border | `0xFF2D2D2D` | Dividers, outlines |
| Muted Text | `0xFF6B7280` | Secondary text |
| Light Text | `0xFF9CA3AF` | Tertiary text |
| White Text | `0xFFE5E7EB` | Primary text on dark |

### Rules
- Use `Theme.of(context).colorScheme.*` for standard semantic colors (primary, surface, error, etc.).
- For custom colors not in the ColorScheme, define them as `static const` in a dedicated file (e.g., `lib/theme/app_colors.dart`) rather than scattering hex values.
- All UI must work in dark mode (this app is dark-only, but don't break if `Brightness.light` is ever added).
- Use opacity/alpha for disabled states: `color.withOpacity(0.38)` for disabled, `0.12` for hover overlays.

---

## 7. Responsive Design

- **Always wrap root layout in `SafeArea`** — this project's conversation screen already does this.
- Use `MediaQuery.of(context).size` to adapt layout for different screen sizes.
- Use `LayoutBuilder` when a widget needs to know its own available space.
- Use `Flexible` and `Expanded` in `Row`/`Column` — never hardcode widths that could overflow on narrow screens.
- Test on small screens (320dp width) and large screens (tablet). The `Positioned` layout in this app should use `MediaQuery` for bottom offsets rather than fixed pixel values if supporting tablets.

---

## 8. Animation Best Practices

This app is animation-heavy (breathing orb, pulsing, waveforms). Follow these rules:

- Use `SingleTickerProviderStateMixin` for one controller, `TickerProviderStateMixin` for multiple.
- Always `dispose()` animation controllers.
- Use `Curves.easeInOut` or `Curves.easeOut` for natural-feeling motion. Avoid `Curves.linear` for UI transitions.
- Keep animation durations in a sensible range: 150-300ms for micro-interactions, 500-1500ms for ambient effects.
- Use `AnimatedContainer`, `AnimatedOpacity`, `AnimatedSwitcher` for simple transitions instead of manual `AnimationController` setup.
- For performance-critical animations (like the waveform), use `CustomPainter` with `shouldRepaint` returning `true` only when data changes.

---

## 9. Performance

- **Never** perform I/O, computation, or object instantiation in `build()`.
- Use `ListView.builder` / `SliverList` for dynamic lists — never `Column(children: items.map(...).toList())` for lists that could grow.
- Cap rolling buffers (this project caps waveform at 30 samples, transcripts at 100 entries).
- Use `RepaintBoundary` around expensive paint operations (e.g., the amber orb, waveform).
- Use `const` constructors wherever possible — they prevent unnecessary rebuilds.
- Avoid `setState(() {})` that triggers full widget rebuilds when only a small part changed — extract the changing part into its own widget.

---

## 10. Accessibility

- Set `Semantics` labels on all interactive elements that lack visible text.
- Ensure contrast ratios meet WCAG AA: 4.5:1 for normal text, 3:1 for large text (18sp+ or 14sp bold).
- Never rely solely on color to convey meaning — pair with icons or text.
- Support `MediaQuery.boldTextOf(context)` and `textScaleFactor` — don't fight the system.
- Test with TalkBack (Android) / VoiceOver (iOS) for screen reader compatibility.

---

## 11. Navigation Patterns

The app's navigation approach is evolving. **Do not assume a specific navigation pattern** — ask the user before introducing new navigation flows.

**Principles:**
- **Match complexity to need.** Don't add a routing package for a 2-screen app. Don't hand-roll navigation for a 10-screen app. Pick the simplest tool that works.
- **Be consistent.** If the app uses bottom sheets for secondary content, don't introduce a new full-screen push for the same type of content without discussion.
- **Respect the back stack.** Every navigation action should have a clear way back. Test that the system back button/gesture does the right thing.
- **Transitions should feel native.** Use platform-default transitions unless the design explicitly calls for something custom. Keep custom transition durations in the 250-350ms range.

**Available Flutter navigation tools** (know when to reach for each):

| Tool | When to use |
|------|-------------|
| `Navigator.push` / `pop` | Simple imperative flows, 1-3 screens |
| `showModalBottomSheet` | Secondary content, drawers, pickers |
| `showDialog` / `showGeneralDialog` | Confirmations, alerts, modal overlays |
| `go_router` / `auto_route` | Deep linking, 5+ routes, complex nested navigation |
| `PageRouteBuilder` | Custom transition animations |

**When adding navigation to a new feature, ask the user** which pattern fits their design intent.

---

## 12. Error State Patterns

Error presentation is evolving — **do not hardcode a specific error UI pattern** without checking with the user first. The principles below apply regardless of presentation choice (modal/overlay, inline, snackbar, etc.).

**Principles:**
- **Every error needs an escape hatch.** Always provide an action — retry, dismiss, navigate away. Never show an error with no way out.
- **One pattern per error class.** Pick a single presentation for each severity level and use it everywhere. Don't mix inline errors and modals for the same class of problem.
- **Use semantic colors.** Error text/icons use `Theme.of(context).colorScheme.error` and `errorContainer` / `onErrorContainer` for backgrounds. Don't hardcode red hex values.
- **Be human.** Include enough context for the user to understand what went wrong, but don't dump stack traces or internal error codes. Voice-first users may have just heard a failure — the visual should reassure, not alarm.
- **Handle all three async states.** Any widget consuming async data must handle loading, error, and empty/data states explicitly. Never let an unhandled error silently render nothing.

**When adding error UI to a screen, ask the user** which presentation they prefer:
- Modal/overlay (centered, blocks interaction until dismissed)
- Inline (embedded in the layout flow)
- Snackbar/toast (transient, auto-dismissing)
- Status bar integration (subtle, non-blocking)

---

## 13. Haptic Feedback

For a voice-first mobile app, tactile feedback reinforces user actions. The specific mapping of interactions to haptic types is a design decision — **ask the user** before adding haptics to new features.

**Principles:**
- **Less is more.** Not every tap needs a buzz. Reserve haptics for meaningful state changes the user needs to feel (e.g., toggling a mode, connection events), not routine button presses.
- **Fire before the async work.** Call the haptic method *before* the async operation, not in its callback — the feedback should be instant.
- **Haptics are safe to call unconditionally.** They are no-ops on platforms that don't support them (web, desktop).

**Available haptic types** (from `package:flutter/services.dart`):

| Method | Feel | Typical use |
|--------|------|-------------|
| `HapticFeedback.lightImpact()` | Subtle tap | Confirmations, selections |
| `HapticFeedback.mediumImpact()` | Firm tap | Toggles, mode switches |
| `HapticFeedback.heavyImpact()` | Strong thud | Errors, destructive actions |
| `HapticFeedback.selectionClick()` | Soft click | Scroll snapping, picker changes |
| `HapticFeedback.vibrate()` | Long buzz | Avoid — too aggressive for most UX |

```dart
// Pattern: haptic fires immediately, then the action
void _onToggle() {
  HapticFeedback.mediumImpact();
  _service.toggle();
}
```

---

## 14. Platform-Adaptive Patterns

Flutter runs on iOS and Android — respect platform conventions where they diverge, but don't over-engineer platform branching.

**Principles:**
- **Let Flutter handle it.** Most Material widgets already adapt per-platform (scroll physics, back gestures, text selection). Don't override unless you have a specific reason.
- **Don't fight the system.** Don't hardcode font families (Flutter picks Roboto/SF Pro automatically). Don't override scroll physics. Don't suppress system back gestures unless you need a confirmation dialog.
- **Branch on platform sparingly.** Only use platform checks for genuinely different UX (share sheets, permission flows), not for styling differences.
- **Prefer `Theme.of(context).platform`** over `dart:io`'s `Platform.isIOS` — it works on web too.

**Tools to know:**

| Tool | Purpose |
|------|---------|
| `PopScope` (Flutter 3.16+) | Intercept back navigation (e.g., confirm before leaving a call) |
| `SystemChrome.setSystemUIOverlayStyle()` | Control status bar icon brightness per-screen |
| `Theme.of(context).platform` | Platform detection that works on web |
| `defaultTargetPlatform` | Platform detection for non-widget code |

```dart
// Intercepting back navigation when needed
PopScope(
  canPop: !isInCall,
  onPopInvokedWithResult: (didPop, _) {
    if (!didPop) _showConfirmation(context);
  },
  child: Scaffold(...),
)
```

---

## 15. Implementation Checklist

When building or modifying a Flutter component, verify:

- [ ] All touch targets are >= 48x48 dp
- [ ] No font size below 12sp (11sp absolute minimum for metadata)
- [ ] Spacing uses 4dp grid multiples
- [ ] Colors reference theme or named constants (no loose hex values)
- [ ] `const` constructors used where possible
- [ ] No business logic in `build()` methods
- [ ] Animation controllers are disposed
- [ ] `SafeArea` wraps the root layout
- [ ] Widget tree depth is reasonable (extract if > 5-6 levels deep)
- [ ] Error states handled (loading, error, empty) for async data
- [ ] Haptic feedback on meaningful state changes (mute, connect, error)
- [ ] Platform-appropriate back navigation handled
- [ ] Before large refactors, remind user to commit or create a checkpoint

---

## 16. File Organization

```
apps/mobile/lib/
├── main.dart                    # App entry, ThemeData, routing
├── models/                      # Immutable data classes, enums
│   ├── conversation_state.dart
│   └── health_state.dart
├── screens/                     # Full-screen layouts (orchestration)
│   └── conversation_screen.dart
├── services/                    # Business logic (ChangeNotifier)
│   ├── livekit_service.dart
│   └── health_service.dart
├── widgets/                     # Reusable UI components
│   ├── amber_orb.dart
│   └── status_bar.dart
└── theme/                       # (Recommended) Centralized design tokens
    ├── app_colors.dart          # Named color constants
    ├── app_spacing.dart         # Spacing scale (xs, sm, md, lg, xl)
    └── app_typography.dart      # Custom text styles
```

When creating new widgets, place them in `widgets/`. When creating new screens, place them in `screens/`. Keep services in `services/` and models in `models/`.

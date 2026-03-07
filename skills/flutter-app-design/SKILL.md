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

This app is currently single-screen. When adding new screens, follow these rules:

- **Simple flows (1-3 screens):** Use `Navigator.push` / `Navigator.pop` directly. No routing package needed.
- **Modal content (drawers, panels, pickers):** Use `showModalBottomSheet` — this is the established pattern (transcript drawer, artifact drawer, health panel).
- **Full-screen detail views:** Use `MaterialPageRoute` with a back button. Keep it simple.
- **Do NOT add `go_router` or `auto_route`** unless the app grows beyond 5+ distinct routes. The overhead isn't justified for a voice-first app.

```dart
// Simple navigation — preferred for this project
Navigator.of(context).push(
  MaterialPageRoute(builder: (_) => const SettingsScreen()),
);

// Modal content — established pattern
showModalBottomSheet(
  context: context,
  isScrollControlled: true,
  backgroundColor: const Color(0xFF1F1F1F),
  shape: const RoundedRectangleBorder(
    borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
  ),
  builder: (_) => const TranscriptDrawer(),
);
```

**Screen transitions:**
- Use default `MaterialPageRoute` transitions (platform-appropriate slide).
- For custom transitions, use `PageRouteBuilder` — don't fight platform conventions unless the design demands it.
- Keep transition durations at 250-350ms (Material 3 default).

---

## 12. Error State Patterns

Display errors consistently across the app. Follow the existing conversation screen pattern:

| Error Type | Pattern | Example |
|------------|---------|---------|
| Transient (network blip, retry-able) | **Snackbar** | "Connection lost. Retrying..." |
| Blocking (can't proceed) | **Inline error box** | Red-tinted container in the main layout (existing pattern) |
| Validation (user input) | **Inline below field** | Red text below the input with error message |
| Fatal (app crash, unrecoverable) | **Full-screen error** | Centered message + retry button |

**Rules:**
- Use the existing error box pattern from `conversation_screen.dart` for connection/agent errors.
- Snackbars for transient feedback: `ScaffoldMessenger.of(context).showSnackBar(...)`.
- Always provide an action (retry, dismiss, navigate away) — never show an error with no way out.
- Error text uses `Theme.of(context).colorScheme.error` — currently maps to a red from the amber seed.
- Include enough context for the user to understand what happened, but don't dump stack traces.

```dart
// Inline error box — matches existing pattern
if (state.hasError)
  Container(
    margin: const EdgeInsets.symmetric(horizontal: 16),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.errorContainer,
      borderRadius: BorderRadius.circular(12),
    ),
    child: Text(
      state.errorMessage,
      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
        color: Theme.of(context).colorScheme.onErrorContainer,
      ),
    ),
  ),
```

---

## 13. Haptic Feedback

For a voice-first mobile app, tactile feedback reinforces user actions. Use haptics deliberately:

| Interaction | Haptic | Method |
|-------------|--------|--------|
| Mute/unmute toggle | Medium impact | `HapticFeedback.mediumImpact()` |
| Connection established | Success (light) | `HapticFeedback.lightImpact()` |
| Connection lost / error | Heavy impact | `HapticFeedback.heavyImpact()` |
| Drawer open/close | Selection click | `HapticFeedback.selectionClick()` |
| Long press actions | Light impact | `HapticFeedback.lightImpact()` |
| Button taps (standard) | None | Rely on visual/audio feedback |

**Rules:**
- Import `import 'package:flutter/services.dart';` for `HapticFeedback`.
- **Don't overuse haptics.** Not every tap needs a buzz. Reserve for state changes the user needs to feel.
- Call haptics **before** the async operation, not after — the feedback should be instant.
- Haptics are no-ops on platforms that don't support them (web, desktop) — safe to call unconditionally.

```dart
// Mute toggle with haptic
void _onMuteToggle() {
  HapticFeedback.mediumImpact();
  _service.toggleMute();
}

// Connection event in service listener
void _onStateChanged() {
  if (_service.state.status == ConversationStatus.connected) {
    HapticFeedback.lightImpact();
  }
  if (mounted) setState(() {});
}
```

---

## 14. Platform-Adaptive Patterns

Flutter runs on iOS and Android — respect platform conventions where they diverge:

- **Back navigation:** Android has a system back gesture/button. Use `WillPopScope` (or `PopScope` on Flutter 3.16+) to intercept if needed (e.g., confirm before disconnecting a call). iOS uses swipe-to-go-back on `MaterialPageRoute` by default.
- **Status bar style:** Set via `SystemChrome.setSystemUIOverlayStyle()` in `main.dart` or per-screen. This app uses dark backgrounds, so use light status bar icons.
- **Scroll physics:** `MaterialPageRoute` and `ListView` automatically use platform-appropriate physics (bouncing on iOS, clamping on Android). Don't override unless necessary.
- **Fonts:** Flutter uses Roboto on Android and SF Pro on iOS by default via the Material theme. Don't hardcode font families unless using a custom brand font.

```dart
// Platform-aware back handling (Flutter 3.16+)
PopScope(
  canPop: !isInCall,
  onPopInvokedWithResult: (didPop, _) {
    if (!didPop) {
      // Show "are you sure?" dialog
      _showDisconnectConfirmation(context);
    }
  },
  child: Scaffold(...),
)

// Status bar styling for dark backgrounds
SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
  statusBarColor: Colors.transparent,
  statusBarIconBrightness: Brightness.light, // Android
  statusBarBrightness: Brightness.dark,      // iOS
));
```

**Platform checks** — use sparingly:
- Prefer `Theme.of(context).platform` over `dart:io`'s `Platform.isIOS` when possible (works on web too).
- Only branch on platform for genuinely different UX (e.g., share sheet, permissions dialogs), not for styling.

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

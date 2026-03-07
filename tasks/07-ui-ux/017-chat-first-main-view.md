# TASK-017: Chat-First Main View Redesign

## Status
- **Status:** Not started
- **Priority:** High
- **Depends on:** 016 (TUI Design System)
- **Owner:** TBD
- **Created:** 2026-03-07

## Context
The current Fletcher UI centers on the Amber Orb visualizer with a pull-up transcript drawer. The new direction puts the chat transcript front and center as the primary content area, with a compact waveform at the top and a mic button at the bottom.

This is the core layout change — it restructures the entire main screen from a `Stack` + `Positioned` layout to a `Column`-based layout.

## Reference
- **Mockup:** [`mockups/chat-main-view.png`](./mockups/chat-main-view.png)
- **Design philosophy:** See [EPIC.md — Design Philosophy](./EPIC.md#design-philosophy)
- **Current code:** `apps/mobile/lib/screens/conversation_screen.dart`

## Layout (top to bottom)

The main screen becomes a `Column` inside `SafeArea`:

```
┌──────────────────────────────────────┐
│  ████ ██ ███ █ ████ ██ ███ █ ███ █  │  ← Compact 8-bit waveform (48dp)
├──────────────────────────────────────┤
│ [●] SYS: OK | VAD: 0.82 | RT: 12ms │  ← Diagnostics status bar (task 019)
│                      [ ARTIFACTS: 2 ]│
├──────────────────────────────────────┤
│                                      │
│ ┌─ USER                             │  ← Chat transcript (Expanded)
│ │ Initialize Fletcher diagnostic...  │
│ └──                                  │
│ ---                                  │
│ ┌─ AGENT                            │
│ │ Fletcher console initialized...    │
│ │ [ARTIFACT: INIT_LOG]               │
│ └──                                  │
│                                      │
├──────────────────────────────────────┤
│              [ 🎤 ]                  │  ← Mic button (56dp, centered)
└──────────────────────────────────────┘
```

### 1. Compact 8-Bit Waveform Bar (top)
- Height: **48dp** (on 4dp grid, provides adequate touch area if waveform becomes tappable later)
- Full width, `AppSpacing.base` (16dp) horizontal padding
- Discrete vertical bars — 8-bit histogram style, not smooth curves
- **Dual-color:** amber bars for user audio levels, cyan bars for agent audio levels
- Driven by `Participant.audioLevel` for both local and remote participants
- Adapt existing `AudioWaveform` `CustomPainter` — change from smooth bars to discrete stepped bars
- Wrap in `RepaintBoundary` for performance (repaints at 100ms polling rate)
- Supersedes task 008 (Collaborative Waveform)

### 2. Diagnostics Status Bar
- See task 019 for full spec
- Sits below waveform, separated by `AppSpacing.xs` (4dp)

### 3. Chat Transcript (main content — `Expanded`)
- **Use `ListView.builder`** for the transcript list — never `Column(children: items.map(...).toList())` since transcript can grow unbounded
- Each message is a `TuiCard` (from task 016) with `TuiHeader` showing `┌─ USER` or `┌─ AGENT`
- Agent messages: amber left border (2dp wide)
- User messages: no border accent (distinguish by header color)
- `---` divider between exchange pairs (user→agent or vice versa), using `Divider` with `AppColors.textSecondary`
- Inline `[ARTIFACT: NAME]` buttons within agent messages (see task 018)
- **Auto-scroll:** Scroll to bottom on new messages, but **stop auto-scrolling when user scrolls up** to read history. Resume auto-scroll when user scrolls back to bottom.
- Real-time updates: interim STT text appears in the latest message card, updating as transcript events arrive
- Message padding: `AppSpacing.md` (12dp) internal, `AppSpacing.sm` (8dp) between messages
- Cap transcript display at 100 entries (existing `kMaxTranscriptEntries`)
- **Replaces** the current `TranscriptDrawer` — transcript is no longer hidden behind a pull-up gesture

### 4. Mic Button (bottom, anchored)
- **Size: 56dp** (Material 3 standard FAB size, exceeds 48dp minimum touch target)
- Centered horizontally, `AppSpacing.base` (16dp) bottom padding above the system nav area
- Amber icon on dark background, sharp rectangle border (no rounded corners — this is brutalist)
- **Inherits Amber Orb state behaviors:**
  - **Idle:** Static amber mic icon
  - **Listening:** Subtle amber glow pulse (500ms period, `Curves.easeInOut`)
  - **Thinking/processing:** Spinning arc overlay migrated from task 015 Phase 2 (`_spinController`, 1200ms rotation)
  - **Speaking:** Active pulse synced to agent audio level (150ms response, `Curves.easeOut`)
  - **Muted:** Dimmed mic icon with `mic_off` icon, `withOpacity(0.38)` per disabled state guideline
  - **Error/Reconnecting:** `AppColors.healthRed` or `AppColors.healthYellow` border
- Tap to toggle mute: `HapticFeedback.mediumImpact()` fires before `_liveKitService.toggleMute()`
- Use `Semantics(label: 'Microphone, currently ${state}. Double tap to toggle mute')` for accessibility

### TUI Message Card Structure
Each message rendered as a widget (not literal box-drawing characters):
```dart
TuiCard(
  borderColor: isAgent ? AppColors.amber : null,
  child: Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      TuiHeader(label: role, color: isAgent ? AppColors.amber : AppColors.cyan),
      SizedBox(height: AppSpacing.sm),  // 8dp
      Text(message.text, style: AppTypography.body),
      if (artifacts.isNotEmpty) ...[
        SizedBox(height: AppSpacing.sm),
        ...artifactButtons,  // Inline [ARTIFACT: NAME] buttons (task 018)
      ],
    ],
  ),
)
```

The `┌─ AGENT` and `└──` decorators are rendered by `TuiHeader` and the bottom of `TuiCard` — **not** as literal text characters in the message body.

## Error & Reconnecting States
The current `Positioned` error overlay (lines 218-249 of `conversation_screen.dart`) is replaced by:
- **Status bar integration:** `SYS: RECONNECTING` or `SYS: ERROR` with yellow/red health orb (task 019)
- **Inline banner** at the top of the chat area: a `TuiCard` with `AppColors.healthRed` or `AppColors.healthYellow` border showing the error/reconnecting message. Appears above the transcript, scrolls away as messages arrive.
- The mic button border also changes color to reflect the error state.

## Migration Plan
1. Create new `ChatMainView` widget (or rename/restructure `ConversationScreen`)
2. Replace `Stack` + `Positioned` layout with `Column`:
   - Waveform bar
   - Status bar (task 019)
   - `Expanded` chat transcript (`ListView.builder`)
   - Mic button row
3. Migrate `AmberOrb` state machine logic to `MicButton` widget
4. Promote `TranscriptDrawer` content to the main `ChatTranscript` widget
5. Adapt `AudioWaveform` to compact 8-bit style
6. Move `_spinController` from current orb to mic button
7. Remove `AmberOrb` from center, `TranscriptSubtitle` (replaced by inline chat), status indicator pill (replaced by status bar)

## Acceptance Criteria
- [ ] Chat transcript is the primary content area (visible without pulling up a drawer)
- [ ] Layout uses `Column` structure, not `Stack` + `Positioned`
- [ ] Transcript uses `ListView.builder` (not `Column` with `map`)
- [ ] Compact 8-bit waveform bar at top reflects real audio levels (dual-color amber/cyan)
- [ ] Waveform wrapped in `RepaintBoundary`
- [ ] Mic button at bottom: 56dp, shows all conversation states (idle, listening, thinking, speaking, muted, error)
- [ ] Spinner overlay on mic button during thinking state
- [ ] Mic button tap fires haptic feedback before toggling mute
- [ ] Mic button has Semantics label for accessibility
- [ ] Messages use TUI-style card format with `TuiHeader` corner bracket headers
- [ ] Auto-scroll to latest message; pauses when user scrolls up
- [ ] Error/reconnecting states shown in status bar + inline banner (no floating overlay)
- [ ] Amber Orb removed from center of screen
- [ ] All spacing on 4dp grid, all colors from `AppColors`, all text from `AppTypography`
- [ ] No font size below 12sp (except 11sp `labelSmall` for timestamps)

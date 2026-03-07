# TASK-021: ASCII "Shooting Arrow" Thinking Animation

## Status
- **Status:** Open
- **Priority:** Medium
- **Depends on:** 017 (Chat-First Main View), 020 (Inline Connection Events)
- **Owner:** TBD
- **Created:** 2026-03-07

## Context
When the agent is "thinking" — between the user finishing speaking and the first agent text streaming in — the chat transcript should show a **dynamic ASCII animation** of an arrow shooting across the screen and exploding into pixels. This replaces the static/incremental arrow concept with a high-energy Brutalist performance.

## Design

### Animation Loop: The Shooting Arrow
A multi-phase ASCII animation sequence rendered in monospace amber color.

**Phases:**
1. **Notch:** An arrow `>>--->` appears on the left margin.
2. **Streak:** The arrow travels horizontally across the chat line toward the right margin. The "flight" is quantized (character-by-character steps).
3. **Impact:** Upon hitting the right margin, the arrow "shatters" into a cloud of pixel-like ASCII particles (e.g., `*`, `.`, `:`, `'`, `+`).
4. **Rebirth:** Particles fade/dissipate, and the loop repeats (Notch -> Streak -> Impact) until the agent starts speaking.

**Aesthetic:**
- **Monospace characters only** (no icons)
- **Amber color** (`AppColors.amber`)
- **8-bit / Quantized motion** — motion occurs in character-width steps for that retro "terminal" feel.

### Widget Placement
- Appears as the **last item in the chat transcript** ListView.
- Sits inside a `TuiCard` with an amber left border.
- Occupies a single horizontal line within the card.

### Lifecycle
1. **Appears when:** `ConversationStatus` transitions to `processing` (Agent is thinking).
2. **Disappears when:** The first `agent_transcript` data channel event arrives — the animation is replaced by the streaming text.
3. **Also disappears if:** Status returns to `idle` without any agent response (timeout/error case).

## Implementation

### New Widget: `ThinkingSpinner`
`lib/widgets/thinking_spinner.dart`

```dart
class ThinkingSpinner extends StatefulWidget {
  const ThinkingSpinner({super.key});

  @override
  State<ThinkingSpinner> createState() => _ThinkingSpinnerState();
}
```

- Uses `AnimationController` to drive the horizontal offset of the arrow.
- Offset is mapped to character positions (e.g., `String.padLeft(offset)`).
- A second `AnimationController` or a specific frame range handles the "explosion" particles after the offset reaches the margin.
- Wrapped in `TuiCard` with amber left border.

### Chat Transcript Integration
In `chat_transcript.dart`, ensure the `ThinkingSpinner` is appended to the ListView when the agent is in the thinking state.

## Acceptance Criteria
- [ ] Thinking animation appears in chat transcript when agent is processing.
- [ ] Animation features a shooting arrow `>>--->` that travels across the line.
- [ ] Arrow "explodes" into ASCII particles on the right margin.
- [ ] Animation is rendered in amber monospace inside a TuiCard.
- [ ] Animation disappears/transitions when agent transcript text streams in.
- [ ] No performance lag in the chat ListView during animation.
- [ ] Unit tests for `ThinkingSpinner` (animation phases, reset logic).

# TASK-021: Thinking Spinner in Chat Transcript

## Status
- **Status:** Open
- **Priority:** Medium
- **Depends on:** 017 (Chat-First Main View), 020 (Inline Connection Events)
- **Owner:** TBD
- **Created:** 2026-03-07

## Context
When the agent is "thinking" — between the user finishing speaking and the first agent text streaming in — the chat transcript should show a **thematic animated spinner** inline. This gives the user immediate visual feedback that the agent received their input and is composing a response.

The spinner appears as a temporary chat item at the bottom of the transcript (where the agent's response will eventually appear). Once the first `agent_transcript` chunk arrives, the spinner is replaced by the streaming text.

The app is called **Fletcher** (a fletcher crafts arrows), so the spinner should evoke that identity — an arrow being drawn, nocked, or in flight.

## Design

### Animation: Arrow Fletching Sequence
A **4-frame ASCII arrow animation** cycling through stages of an arrow being drawn/released. Rendered in monospace, amber color, inside a compact TuiCard with no header.

**Frame sequence** (cycling at ~300ms per frame):

```
Frame 1:   ─ ─ ─ ─ ─ >
Frame 2:   ── ── ── ── >
Frame 3:   ═══════════ >
Frame 4:   - - - - - - →
```

Alternative concept — **arrow nocking** (bow-draw metaphor):

```
Frame 1:   ◁───────
Frame 2:   ◁─────── ·
Frame 3:   ◁═══════ ▸
Frame 4:             →
```

Alternative concept — **fletching spin** (arrow rotating in flight):

```
Frame 1:   ──── ▸
Frame 2:   ╌╌╌╌ ▸
Frame 3:   ···· ▸
Frame 4:   ─·─· ▸
```

**Pick the one that looks best in practice.** The key constraints are:
- **Monospace characters only** — no custom icons or images
- **Amber color** (`AppColors.amber`) — consistent with agent identity
- **Compact** — single line, no taller than a system event card
- **8-bit / retro feel** — matches the TUI brutalist aesthetic
- **NOT a circular spinner or hourglass** — those are explicitly excluded

### Widget Placement
- Appears as the **last item in the chat transcript** ListView
- Sits inside a `TuiCard` with an amber left border (like agent messages)
- No `TuiHeader` — this is a transient indicator, not a conversation turn
- Left-aligned with slight indent matching agent message content area
- Uses `AnimatedBuilder` with a looping `AnimationController` (period ~1200ms for 4 frames)

### Lifecycle
1. **Appears when:** `ConversationStatus` transitions to `processing` AND no agent transcript is currently streaming (i.e., no interim `agent_transcript` with matching segmentId exists)
2. **Disappears when:** The first `agent_transcript` data channel event arrives (interim or final) — the spinner is replaced by the streaming text
3. **Also disappears if:** Status returns to `idle` without any agent response (timeout/error case)

### State Integration
The spinner visibility is derived from existing state — no new state fields needed:
- **Show spinner:** `status == ConversationStatus.processing` AND `transcript.last.role != TranscriptRole.agent || transcript.last.isFinal`
- **Hide spinner:** An interim agent transcript entry appears (role == agent, isFinal == false)

Alternatively, add a simple `bool isAgentThinking` to `ConversationState` that is set `true` on processing start and `false` on first agent transcript chunk. This is cleaner and avoids edge cases.

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

- Uses `AnimationController` with `vsync: this` (needs `SingleTickerProviderStateMixin`)
- 4-frame sequence, 300ms per frame (1200ms total cycle)
- Each frame is a `Text` widget with monospace amber styling
- Wrapped in `TuiCard` with amber left border, no header
- `AnimatedSwitcher` for smooth frame transitions (optional — could also be instant swap for 8-bit feel)

### Chat Transcript Integration
In `chat_transcript.dart`, add a `_ChatItem.thinking()` variant:
- Appended to the items list when `isAgentThinking` is true
- Positioned after all existing messages (last item before auto-scroll anchor)
- Removed from list when first agent transcript arrives

### ConversationState Change
Add `bool isAgentThinking` field:
- Set `true` in `livekit_service.dart` when status transitions to `processing`
- Set `false` when first `agent_transcript` event is received for a new segment
- Set `false` when status returns to `idle` or `error`

## Acceptance Criteria
- [ ] Thinking spinner appears in chat transcript when agent is processing
- [ ] Spinner uses thematic arrow/fletching ASCII animation (not circular, not hourglass)
- [ ] Animation is 4+ frames, cycling at ~300ms per frame
- [ ] Spinner is rendered in amber monospace inside a TuiCard with amber left border
- [ ] Spinner disappears when first agent transcript text streams in
- [ ] Spinner disappears if status returns to idle without response
- [ ] No flicker or duplicate spinners on rapid state changes
- [ ] Auto-scroll keeps spinner visible when it appears
- [ ] Unit tests for ThinkingSpinner widget (animation frames, lifecycle)
- [ ] Unit tests for isAgentThinking state transitions

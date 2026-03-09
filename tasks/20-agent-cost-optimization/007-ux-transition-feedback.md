# Task 007: UX Polish — Transition Feedback

**Epic:** 20 — Agent Cost Optimization
**Status:** [ ]
**Priority:** Medium

## Problem

Users need to understand what's happening during agent lifecycle transitions. Without clear feedback, the experience feels broken — "Why isn't Fletcher responding?" when the agent is disconnected, or "What's happening?" during the dispatch delay.

## Solution

Design and implement visual/audio feedback for each agent presence state, using the existing TUI Brutalist design system.

## UX Design

### AGENT_ABSENT state
- **Amber Orb:** Dim pulse (breathing animation, lower intensity than active)
- **System event:** `[AGENT] Idle — speak to summon` (shown once on transition)
- **Header:** Subtle indicator showing agent is on standby
- **Mic button:** Normal appearance — user can tap to speak at any time

### DISPATCHING state
- **Amber Orb:** Fast pulse / spin animation (SweepGradient from existing thinking state)
- **System event:** `[AGENT] Summoning...`
- **Duration:** Typically <500ms, so this may flash briefly
- **If >2s:** Show `[AGENT] Still connecting...` to reassure user

### AGENT_PRESENT state
- **Normal UI** — no changes from current behavior
- **System event on arrival:** `[AGENT] Connected` (brief, auto-dismisses)

### IDLE_WARNING state
- **System event:** `[AGENT] Going idle in 30s — speak to stay connected`
- **Amber Orb:** Gradual dim-down animation over 30s
- **If user speaks:** Warning dismissed, system event `[AGENT] Staying connected`

### AGENT_DISCONNECTED transition
- **System event:** `[AGENT] Disconnected (idle timeout)`
- **Brief audio cue:** Optional — soft descending tone (2 notes)
- **Transition to AGENT_ABSENT UI**

### Re-dispatch after idle
- **Audio cue:** Optional — soft ascending tone (2 notes) when agent connects
- **System event:** `[AGENT] Reconnected`

## Implementation Notes

- Leverage existing `SystemEvent` model and `SystemEventCard` widget (Epic 11, Task 020)
- Leverage existing `AmberOrb` state machine for visual transitions
- New `AgentPresenceState` maps to `AmberOrb` animation states
- Keep audio cues minimal and optional (respect existing TTS on/off toggle)

## Files to Modify

- `apps/mobile/lib/widgets/` — AmberOrb animation states, system event integration
- `apps/mobile/lib/services/agent_presence_service.dart` — emit system events on transitions

## Acceptance Criteria

- [ ] Each agent presence state has distinct visual feedback
- [ ] System events appear in chat transcript for lifecycle transitions
- [ ] "Speak to summon" hint is clear but not annoying
- [ ] Dispatching state visible even for brief (<500ms) transitions
- [ ] Idle warning shows countdown
- [ ] Transitions feel smooth, not jarring

## Dependencies

- Task 005 (Client State Machine) — provides the state transitions to render

# TASK-014: Visual Feedback for Long-Press Detection

## Status
- **Status:** Partial — haptic feedback done, visual cue (progress ring) deferred
- **Priority:** Low
- **Owner:** Unassigned
- **Created:** 2026-03-08

## Epic
- [Epic 17: Text Input Mode](./EPIC.md)

## Problem
Users need immediate feedback that a long-press is being detected, so they know to keep holding. Without feedback, the gesture feels unresponsive.

## Solution
1. Add haptic feedback on long-press start (`HapticFeedback.mediumImpact()`)
2. Consider a subtle visual cue during the hold:
   - Mic button scale animation (slight grow/pulse)
   - Color shift or glow effect on the Amber Orb
   - Radial progress indicator around the button
3. On long-press completion, trigger a stronger haptic burst
4. Keep feedback subtle — don't distract from the primary voice UX

## Acceptance Criteria
- [x] Haptic feedback fires on long-press detection (HapticFeedback.heavyImpact)
- [ ] Visual cue indicates the long-press is in progress (future: add radial progress)
- [x] Feedback feels responsive and intentional

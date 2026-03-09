# TASK-005: Implement Expanding/Sliding Animation for Text Input Field

## Status
- **Status:** Complete
- **Priority:** Medium
- **Owner:** Unassigned
- **Created:** 2026-03-08

## Epic
- [Epic 17: Text Input Mode](./EPIC.md)

## Problem
When the Mic button slides right, a text input field needs to expand/slide in from the left to fill the vacated space. The reverse happens when returning to voice-first mode.

## Solution
1. Use the same `AnimationController` as the Mic button slide (synchronized animations)
2. Animate the text field's width and/or position from collapsed (zero width) to full available width
3. Use `SizeTransition`, `AnimatedContainer`, or custom animation with `AnimatedBuilder`
4. Text field should appear to grow naturally as the Mic button moves aside

## Acceptance Criteria
- [x] Text field expands from left as Mic button slides right
- [x] Text field collapses/slides out when reverting to voice-first mode
- [x] Animation is synchronized with Mic button movement (same controller/duration)
- [x] Transition feels smooth and cohesive

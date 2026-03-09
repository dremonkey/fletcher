# TASK-004: Implement Sliding Animation for Mic Button

## Status
- **Status:** Complete
- **Priority:** Medium
- **Owner:** Unassigned
- **Created:** 2026-03-08

## Epic
- [Epic 17: Text Input Mode](./EPIC.md)

## Problem
When entering text-input mode, the Mic button needs to smoothly slide from its center position to the right side of the toolbar. When reverting to voice-first mode, it slides back to center.

## Solution
1. Use an `AnimationController` with duration ~300-500ms
2. Create a `Tween<Offset>` or `Tween<double>` for horizontal position
3. Animate the Mic button's position using `SlideTransition` or `AnimatedPositioned`
4. Trigger forward animation on entering text-input mode, reverse on exiting
5. Use an appropriate curve (e.g., `Curves.easeInOut`) for fluid motion

## Acceptance Criteria
- [x] Mic button slides from center to right on entering text-input mode
- [x] Mic button slides from right to center on reverting to voice-first mode
- [x] Animation duration is ~300-500ms with smooth easing curve
- [x] No visual jank or layout jumps during transition

# TASK-006: Create AnimationController and Tween Setup

## Status
- **Status:** Complete
- **Priority:** Medium
- **Owner:** Unassigned
- **Created:** 2026-03-08

## Epic
- [Epic 17: Text Input Mode](./EPIC.md)

## Problem
The Mic button slide and text field expansion need a shared animation infrastructure with proper lifecycle management.

## Solution
1. Add `TickerProviderStateMixin` to the relevant widget's State class
2. Create a single `AnimationController` with duration ~400ms
3. Define tweens for:
   - Mic button horizontal offset (center → right)
   - Text field width/opacity (0 → full)
4. Use `CurvedAnimation` with `Curves.easeInOutCubic` for natural feel
5. Dispose controller properly in `dispose()`
6. Listen to ConversationBloc state to trigger `forward()` / `reverse()`

## Acceptance Criteria
- [x] Single `AnimationController` drives both animations in sync
- [x] Proper lifecycle: init in `initState`, dispose in `dispose`
- [x] Smooth curve applied (not linear)
- [x] Controller responds to ConversationBloc state changes

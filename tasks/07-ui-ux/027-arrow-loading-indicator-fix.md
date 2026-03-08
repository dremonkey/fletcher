# TASK-027: Fix Arrow Loading Indicator Rendering

## Status
- **Status:** Open
- **Priority:** Low
- **Owner:** Unassigned
- **Created:** 2026-03-07

## Bug Reference
- [BUG-017](../../docs/field-tests/20260307-buglog.md) — Arrow Loading Indicator is failing to render correctly

## Problem

The ThinkingSpinner arrow indicator in the Brutalist UI lacks the intended "chunky" visual weight and suffers from a "box" artifact — a visible container/background behind the arrow glyph. The intended effect is a bold, pixel-art style arrow, but the current implementation shows a box outline.

## Solution

1. Audit `apps/mobile/lib/widgets/thinking_indicator.dart`
2. If using ASCII/Text widget: fix background color mismatch causing the "box" effect; increase glyph size
3. If using CustomPainter: increase stroke weight, fix Canvas clipping
4. Increase "pixel" size and decrease spacing for the "chunky" look
5. Consider SVG implementation as a fallback if ASCII approach can't achieve the desired weight

## Acceptance Criteria
- [ ] Arrow renders without visible "box" artifact
- [ ] Arrow has intended "chunky" pixel-art visual weight
- [ ] Animation is smooth and performant

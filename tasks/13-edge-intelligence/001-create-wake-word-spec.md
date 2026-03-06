# Task 001: Create Wake Word Spec

## Summary

Define the architecture, requirements, and implementation strategy for local wake word detection on the edge device.

## Status

**Status:** ✅ COMPLETED

## Deliverables

- [x] Spec document created at [docs/specs/wake-word-integration.md](../docs/specs/wake-word-integration.md)

## Decisions

- **Approach:** Local-first, privacy-focused.
- **Engine:** OpenWakeWord (via ONNX) as the primary candidate for open-source, offline capability.
- **Integration:** Directly wired into `AmberOrb` state machine for visual feedback.

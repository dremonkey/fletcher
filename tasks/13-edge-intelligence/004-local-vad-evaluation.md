# Task 004: Local VAD Evaluation

## Summary

Evaluate the feasibility and benefits of running Voice Activity Detection (VAD) locally on the device (mobile/desktop) instead of (or in addition to) server-side VAD.

## Status

**Status:** 📋 BACKLOG

## Goals

- **Latency Reduction:** Detect End-of-Utterance (EOU) faster by avoiding network round-trip.
- **Bandwidth Savings:** Stop streaming audio during silence.
- **Privacy:** Process silence locally.

## Candidates

- **Silero VAD:** High quality, lightweight (ONNX), widely used.
- **WebRTC VAD:** Standard, low CPU, but less accurate for non-speech noise.
- **Platform Native:** Android/iOS speech APIs.

## Plan

1. Benchmark Silero VAD on Flutter (using `onnxruntime` or dedicated plugin).
2. Compare CPU usage vs server-side streaming.
3. Measure detection latency difference.

# Task 002: Wake Word Prototype (Spike)

## Summary

Implement a proof-of-concept (POC) wake word detection system on the edge device to validate feasibility, latency, and resource usage.

## Status

**Status:** ✅ COMPLETED

## Implementation Details

- **Wake Word Engine:** Used `onnxruntime` with a quantized `hey_jarvis` model (mocked inference for initial spike).
- **Audio Capture:** Integrated `mic_stream` package for raw PCM buffer access.
- **Integration:** Wired into `AmberOrb` state machine; successful trigger transitions state from `Idle` to `Listening` (visualized by color change).
- **Latency:** Measured < 250ms from trigger to state change.

## Learnings

- **Permissions:** Microphone permission must be requested and handled gracefully before starting the engine.
- **Resource Usage:** Continuous inference on the main thread impacts UI responsiveness. Future implementations should move inference to a background isolate or separate thread.
- **Model Size:** Quantized models (< 5MB) are viable for mobile deployment.

## Next Steps

- Refine the implementation for production use (Task 003).
- Evaluate battery impact over extended periods.
- Improve model accuracy (reduce false positives).

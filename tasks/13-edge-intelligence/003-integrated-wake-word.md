# Task 003: Integrated Wake Word

## Summary

Integrate the validated Wake Word prototype into the production Fletcher mobile app, enabling hands-free initiation of voice sessions.

## Status

**Status:** 🔄 ROTATING

## Changes

- [x] Integrated into `AmberOrb` state machine:
    - Added `WakeWordTriggered` event.
    - Updated `Idle` state to listen for `WakeWordTriggered`.
    - Wired visual feedback (pulse/color change) to the trigger.
- [ ] Implement robust background audio capture:
    - Ensure mic access persists when app is backgrounded (foreground service integration).
    - Handle interruptions (calls, other audio apps).
- [ ] Optimize for battery life:
    - Implement duty cycling (e.g., wake word active for 5s, off for 5s) if feasible without degrading UX? No, continuous listening needed.
    - Use hardware offload (DSP) if platform supports.
- [ ] Add user controls:
    - Toggle for "Always Listening" vs "Tap to Speak".
    - Sensitivity adjustment.

## Implementation Details

- **File:** `apps/mobile/lib/widgets/amber_orb.dart` (state machine updates)
- **File:** `apps/mobile/lib/services/wake_word_service.dart` (new service)
- **Dependency:** `mic_stream` (for raw audio), `onnxruntime` (for inference).

## Known Issues

- **Background Audio:** Android kills mic access aggressively in background unless `FOREGROUND_SERVICE_MICROPHONE` is active.
- **False Positives:** Need to filter ambient noise before inference.

## Verification

- [ ] Verify wake word triggers correctly in foreground.
- [ ] Verify wake word triggers correctly in background (with screen on/off).
- [ ] Measure battery impact over 1 hour of standby.

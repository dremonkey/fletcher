# Task 005: Offline Mode

## Summary

Enable basic functionality when the device is offline, including local wake word detection, caching of interactions, and limited fallback responses.

## Status

**Status:** 📋 BACKLOG

## Requirements

1. **Wake Word:** Must work offline (already part of Task 002/003).
2. **Offline Caching:** Store spoken requests/text locally when no network is available.
3. **Queueing:** Retry sending cached requests when connectivity is restored.
4. **Offline Feedback:** Notify the user gracefully ("I'm offline right now").

## Edge Cases

- Wake word triggers but no network -> Play "offline" sound or simple TTS if available locally.
- Connectivity drops mid-conversation -> Cache pending transcript segments.

## Strategy

- Use `sqflite` or `hive` for persistent queue.
- Integrate with `connectivity_plus` (Epic 9) to detect network restore.

# Task 011: Voice Selection Persistent Preferences

## Context
Andre wants to be able to switch between different TTS voices in Fletcher (e.g., Ember, Kristen, Ivy) without rebuilding the Docker container. 

## Requirements
1. **Environment Config**: The available voices must be provided via an environment variable `FLETCHER_AVAILABLE_VOICES` as a JSON array of objects:
   ```json
   [
     {"provider": "ElevenLabs", "voiceName": "Kristen", "voiceId": "abc123..."},
     {"provider": "ElevenLabs", "voiceName": "Ember", "voiceId": "xyz789..."}
   ]
   ```
2. **Default Behavior**: If no preference is saved, default to the first voice in the array.
3. **Persistence**: When a user selects a voice via the UI/API, save this preference to a persistent store (e.g., a local JSON file or database) scoped to the user/session.
4. **Integration**: The LiveKit agent audio pipeline must use the selected `voiceId` for TTS generation.

## Implementation Details
- **Location**: `~/code/fletcher/tasks/02-livekit-agent/011-voice-selection-preferences.md`
- **Component**: Fletcher Bridge / LiveKit Agent

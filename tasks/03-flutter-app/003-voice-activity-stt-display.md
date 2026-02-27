# Task: Voice Activity Indicator & Real-Time STT Display

## Description
The mobile app currently has no visual feedback showing that the microphone is picking up audio. Add a voice activity indicator and real-time speech-to-text transcription display to confirm the audio pipeline is working.

## Checklist
- [x] Add visual indicator that mic is actively receiving audio (amplitude/volume level)
- [x] Display real-time STT transcription text in the app UI
- [ ] Confirm audio flows from phone mic through LiveKit to the agent

## Context
- `apps/mobile/lib/screens/conversation_screen.dart` — main UI
- `apps/mobile/lib/services/livekit_service.dart` — LiveKit connection
- Check if LiveKit client SDK exposes audio level or STT transcript events
- The Amber Heartbeat visualizer already responds to `userAudioLevel` — may be able to leverage the same data source
- STT transcripts may come via LiveKit data channel or transcription events

## Why
This is critical for debugging the voice pipeline. We need to confirm audio is flowing from the phone through LiveKit before troubleshooting the agent response issue.

# Task: Debug Voice Agent Not Responding

## Description
After confirming voice/STT is working (see `03-flutter-app/003`), investigate why the voice agent is not responding to user speech.

## Checklist
- [ ] Verify init timeout fix (60s) is sufficient — agent starts without `runner initialization timed out`
- [ ] Confirm Deepgram STT is receiving audio from the LiveKit track
- [ ] Confirm OpenClaw gateway is reachable and responding to chat completions
- [ ] Confirm Cartesia TTS is generating audio output
- [ ] Verify full pipeline: mic → LiveKit → agent STT → Ganglia LLM → TTS → LiveKit → phone speaker
- [ ] Agent responds to voice input end-to-end

## Known State
- Agent connects to cloud LiveKit room successfully ("Connected to room: fletcher-dev")
- Agent receives job requests from LiveKit
- Previously hit `runner initialization timed out` — fixed by increasing `initializeProcessTimeout` to 60s in `voice-agent.ts`
- Not yet confirmed whether the fix is sufficient

## Key Files
- `scripts/voice-agent.ts` — agent entry point
- `packages/livekit-agent-ganglia/src/client.ts` — OpenClaw client
- `packages/livekit-agent-ganglia/src/llm.ts` — LLM bridge

## Blocked By
- `03-flutter-app/003` — need voice activity + STT display to confirm audio is flowing first

# Task: Debug Voice Agent Not Responding ✅

## Description
After confirming voice/STT is working (see `03-flutter-app/003`), investigate why the voice agent is not responding to user speech.

## Checklist
- [x] Verify init timeout fix (60s) is sufficient — agent starts without `runner initialization timed out`
- [x] Confirm Deepgram STT is receiving audio from the LiveKit track
- [x] Confirm OpenClaw gateway is reachable and responding to chat completions
- [x] Confirm Cartesia TTS is generating audio output
- [x] Verify full pipeline: mic → LiveKit → agent STT → Ganglia LLM → TTS → LiveKit → phone speaker
- [x] Agent responds to voice input end-to-end

## Resolution
- Agent dispatch was broken: agent had no `agentName` and used `connect --room` mode
- Fixed by switching to `dev` mode with `agentName: 'livekit-ganglia-agent'`
- Token generator now embeds `RoomConfiguration` with `RoomAgentDispatch` so LiveKit auto-dispatches the agent when a user joins
- Added env var validation at startup for fast failure on missing keys
- STT subtitles confirmed working after container rebuild

## Key Files
- `apps/voice-agent/src/agent.ts` — agent entry point
- `packages/livekit-agent-ganglia/src/client.ts` — OpenClaw client
- `packages/livekit-agent-ganglia/src/llm.ts` — LLM bridge

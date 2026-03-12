# Task 053: Dual-Mode Architecture — Chat / Live Split

**Epic:** 22 — Dual-Mode Architecture
**Status:** [~]
**Depends on:** 052 (Relay LLM Wrapper)

## Goal

Implement two distinct operating modes: **Chat mode** (text via relay participant) and **Live mode** (voice via voice-agent). Disable the current path that sends text messages through the voice agent.

## Context

Currently, text input routes through the voice agent via the `ganglia-events` data channel — even typed messages go through the full STT→LLM→TTS pipeline infrastructure. This is wasteful and creates coupling between text and voice concerns (see EPIC.md bug analysis).

The split:
- **Chat mode:** Flutter → `"relay"` data channel topic → Relay → ACP → OpenClaw. Text-only for now (no TTS). The relay is already in the room as a participant.
- **Live mode:** Flutter → WebRTC audio → voice-agent → Ganglia → OpenClaw → TTS. Unchanged from today.

## Scope

### Remove text-through-agent path
- Disable `text_message` handling in `apps/voice-agent/src/agent.ts` (the data channel listener that picks up typed text from `ganglia-events`)
- Text input will exclusively route through the relay in chat mode

### Mode definition
- **Chat mode:** Relay handles all text. No agent needed. No TTS initially (text responses rendered in transcript only).
- **Live mode:** Voice agent handles audio. Agent dispatched on unmute (existing Epic 20 flow). Relay is passive (stays in room but defers).

### Mode coordination
- Define how the client signals which mode is active (room metadata, data channel signal, or implicit from participant state)
- Ensure relay and agent don't both try to handle the same input
- Persist selected mode across app restarts (SharedPreferences on mobile)

## Not in scope (separate tasks)

- Client-side TTS for chat mode (task 043 — will be added later, independent of livekit-agent)
- Client-side STT (task 044)
- Voice pipeline teardown on mode switch (task 049)
- Full mode switch state machine with in-flight handling (task 046 — this task is the foundation)

## Relates to

- Task 046 (Mode Switch Controller) — this is the concrete first step
- Task 050 (Migrate Text Input from Agent to Relay) — this task implements it

## Acceptance criteria

- [~] Text messages no longer route through voice agent (chat mode routes via relay; voice mode still uses agent — text_message handler not yet removed from agent.ts)
- [x] Chat mode sends text via relay JSON-RPC (`session/prompt`)
- [x] Live mode uses voice agent as before (no regression)
- [x] Client can switch between modes (mic button: muted = chat, unmuted = voice)
- [ ] Both modes share the same OpenClaw session (session key continuity — needs field verification)

# Task 063: ACP Voice Extensions (inject + event)

**Epic:** 22 — Dual-Mode Architecture
**Status:** [ ]
**Depends on:** 061 (AcpLLM Backend)
**Blocks:** none

## Goal

Implement the `_fletcher/voice/inject` (backend → voice agent) and `_fletcher/voice/event` (voice agent → backend) ACP extensions, enabling real-time bidirectional communication between the ACP agent and the voice pipeline.

## Context

The ACP transport spec (`apps/relay/docs/acp-transport.md`) defines two voice-specific JSON-RPC extensions:

- **`_fletcher/voice/inject`** — The ACP agent can push instructions to the voice agent at any time: say text, interrupt current speech, inject system context, or change runtime config (TTS on/off, voice, VAD sensitivity).
- **`_fletcher/voice/event`** — The voice agent pushes pipeline state to the ACP agent: user transcripts (interim + final), agent state transitions, pipeline errors, and per-turn metrics.

These were deferred from the initial AcpLLM implementation (task 061) because OpenClaw does not currently emit or consume these extensions. Implement when OpenClaw adds support.

## Deferred

**Why deferred:** OpenClaw does not currently send `_fletcher/voice/inject` requests or listen for `_fletcher/voice/event` notifications. Building handlers that will never fire is speculative complexity.

**Revisit when:** OpenClaw adds ACP voice extension support, OR when a second ACP agent backend (e.g., Claude Agent SDK) needs push-to-voice or pipeline observability.

## Relates to

- Task 061 (AcpLLM Backend) — plumbing for extensions lives here
- `apps/relay/docs/acp-transport.md` — full spec for both extensions

## Acceptance criteria

- [ ] `_fletcher/voice/inject` handler: say, interrupt, context, config actions
- [ ] `_fletcher/voice/event` notifications: user_transcript, agent_state, pipeline_error, metrics
- [ ] Integration with AgentSession (TTS control, system message injection)
- [ ] Unit tests for all inject actions and event types

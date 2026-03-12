# Task 052: Relay LLM Wrapper for Ganglia

**Epic:** 22 — Dual-Mode Architecture
**Status:** [ ]
**Depends on:** Fletcher Relay (apps/relay)

## Goal

Create a new `LLM` backend in `livekit-agent-ganglia` that routes completions through the Fletcher Relay instead of calling the OpenClaw completions API directly. This allows chat mode to reuse the Ganglia LLM interface while routing through the relay's ACP bridge.

## Context

Today, `GangliaLLM` (via `OpenClawLLM`) calls the OpenClaw Gateway completions API directly over HTTP. For chat mode, we want to route through the relay instead — the relay already bridges JSON-RPC over the LiveKit data channel to the local ACP subprocess (which talks to OpenClaw).

This wrapper doesn't need to be a full LiveKit `LLM` implementation — it's a class that speaks the relay's JSON-RPC protocol (`session/message`) and maps responses back to the stream interface that the rest of the pipeline expects.

## Scope

- New `RelayLLM` class (or similar) in `packages/livekit-agent-ganglia`
- Sends `session/message` JSON-RPC requests to the relay via data channel (topic: `"relay"`)
- Receives streamed `session/update` responses and maps them to `LLMStream`-compatible events (text deltas, artifacts)
- Session management: `session/new` and `session/resume` for session lifecycle
- Shares the same `SessionKey` logic as the existing OpenClaw backend for conversation continuity

## Not in scope

- TTS integration (chat mode TTS is a separate concern, task 043)
- Mode switching logic (task 053)
- Mobile-side JSON-RPC client (task 054)

## Acceptance criteria

- [ ] `RelayLLM` class created with JSON-RPC data channel transport
- [ ] `session/message` sends user text, receives streamed text deltas
- [ ] Artifacts from relay responses are surfaced through the stream interface
- [ ] Unit tests covering request/response mapping

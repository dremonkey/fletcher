# Epic 18: OpenResponses API Integration

**Status:** 🔄 In Progress
**Goal:** Refactor the Fletcher voice agent to use the native OpenClaw **OpenResponses API** (`/v1/responses`) instead of the OpenAI-compatible **Chat Completions API** (`/v1/chat/completions`).

## Purpose

The current Fletcher architecture uses the OpenAI-compatible `/v1/chat/completions` endpoint as a compatibility shim. This endpoint is stateless and was designed for broad interoperability, not for real-time voice sessions.

The **OpenResponses API** is OpenClaw's modern, stateful endpoint designed for:
- **Reliable delivery** — native session management and message persistence
- **Granular SSE events** — item-level streaming instead of chunk-based deltas
- **Richer metadata** — per-item types (text, artifact, tool call, error)
- **Better error handling** — structured error responses with retry guidance

Switching to OpenResponses solves the "silent delivery" issue where the agent hears the user (STT is working) but the response never arrives (HTTP stream hangs or fails silently).

## Architecture

### Current (Chat Completions)
```
Voice Agent
    ↓
OpenClawClient.chat() → fetch(http://localhost:8080/v1/chat/completions)
    ↓
Streaming SSE: data: {"choices": [{"delta": {"content": "..."}}]}
    ↓
LLMStream emits content chunks
    ↓
TTS synthesizes and plays
```

**Failure Point:** If the HTTP fetch hangs, times out, or receives a malformed SSE stream, the entire turn fails silently. The user hears nothing, sees nothing, and has no indication the agent is stuck.

### Target (OpenResponses)
```
Voice Agent
    ↓
OpenClawClient.respond() → fetch(http://localhost:8080/v1/responses)
    ↓
Streaming SSE: event: item.created / item.delta / item.done
    ↓
LLMStream emits typed items (text, artifact, tool_call)
    ↓
TTS synthesizes text items; artifacts bypass TTS
```

**Improvements:**
- **Typed items** — agent can distinguish text (TTS) from artifacts (visual only)
- **Error items** — structured errors with `retry_after` and `error_code`
- **Session persistence** — responses are logged and retrievable even if the stream drops

## Requirements

- **Update `OpenClawClient`** (in `packages/livekit-agent-ganglia/src/client.ts`) to support a new `respond()` method that targets `/v1/responses`
- **Maintain backward compatibility** — keep `chat()` method for legacy use
- **Map OpenResponses events to LLM interface** — convert `item.created` / `item.delta` / `item.done` events into the existing `LLMStream` interface expected by `@livekit/agents`
- **Handle new item types** — route `text` items to TTS, `artifact` items to data channel
- **Update session routing** — ensure SessionKey routing works with OpenResponses (likely already compatible)

## Tasks

- [x] 001: Research OpenResponses API spec — document endpoint, SSE event schema, item types
- [x] 002: Add `respond()` method to OpenClawClient
- [x] 003: Implement OpenResponses SSE parser
- [x] 004: Map OpenResponses events to LLMStream interface
- [x] 005: Update voice agent to use `respond()` instead of `chat()`
- [x] 006: Enhanced error handling for OpenResponses error items
- [~] 007: Integration test with real OpenClaw Gateway (unit tests done, integration pending)
- [ ] 008: Deprecation plan for Chat Completions endpoint

## Success Criteria

- Fletcher voice agent uses `/v1/responses` endpoint by default
- Typed items (text, artifact, tool_call) are handled correctly
- Structured errors provide actionable feedback (retry, rate limit, etc.)
- Silent delivery failures are eliminated (or at least detectable)
- Session continuity is maintained across network drops

## Open Questions

1. **Is OpenResponses already live in the Gateway?** (Memory indicates it was patched in on 2026-02-27, but needs verification)
2. **Does OpenResponses support tool calls?** Or is that a Chat Completions-only feature?
3. **How do we handle multi-turn tool resolution?** OpenResponses may require a different flow for tool calls → tool results → continuation.

## Dependencies

- Epic 4 (Ganglia) — OpenClawClient refactor
- OpenClaw Gateway must have OpenResponses endpoint enabled

## Related Issues

- [BUG-030](../../docs/field-tests/20260307-buglog.md) — Unidirectional Blackout (silent delivery)
- [memory/2026-02-27.md](../../../.openclaw/workspace/memory/2026-02-27.md) — OpenResponses API enabled in Gateway config

## References

- **OpenResponses API Spec** (if available): `TODO: link to spec or Gateway docs`
- **Chat Completions API Spec**: OpenAI-compatible, stateless, chunk-based SSE

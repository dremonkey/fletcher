# Epic 18: OpenResponses API Integration (RECONCILIATION)

**Status:** ✅ COMPLETE
**Goal:** Transition Fletcher from stateless Chat Completions to the native, stateful **OpenClaw OpenResponses API**.

## Summary

This Epic was previously planned but has been **fully implemented** earlier today (likely via a parallel Claude Code/ACP session). 

The `OpenClawClient` in the `livekit-agent-ganglia` package now supports the native `/v1/responses` endpoint, providing significantly higher reliability for voice sessions through item-based streaming and stateful persistence.

## Accomplishments

- **Implemented `respond()` method:** Low-level SSE parser for the `/v1/responses` endpoint with lifecycle event logging.
- **Implemented `respondAsChat()` bridge:** Automatically maps OpenResponses events (text deltas, tool calls, errors) back to the standard Chat Completion format used by the LiveKit pipeline.
- **Structured Error Handling:** Added `RateLimitError` and `OpenResponsesError` with built-in retry guidance.
- **Unified Session Routing:** OpenResponses now uses the same `SessionKey` routing logic as the rest of the fleet.
- **Voice Agent Integration:** The `OpenClawLLM` has been updated to use OpenResponses by default (controlled via `USE_OPENRESPONSES` env var).

## Verified Implementation

- **Client:** `packages/livekit-agent-ganglia/src/client.ts`
- **Types:** `packages/livekit-agent-ganglia/src/types/openresponses.ts`
- **LLM Logic:** `packages/livekit-agent-ganglia/src/llm.ts`

## Next Steps

- [ ] Perform a live field test to verify "fail-over" behavior when the stream is interrupted.
- [ ] Monitor logs for `response.failed` events to tune retry logic.
- [ ] Update documentation for external contributors.

# Epic 18: OpenResponses API Integration (RECONCILIATION)

**Status:** ✅ COMPLETE
**Goal:** Transition Fletcher from stateless Chat Completions to the native, stateful **OpenClaw OpenResponses API**.

## Summary

This Epic was previously planned but has been **fully implemented** earlier today (likely via a parallel Claude Code/ACP session). 

The `OpenClawClient` in the `livekit-agent-ganglia` package now supports the native `/v1/responses` endpoint, providing significantly higher reliability for voice sessions through item-based streaming and stateful persistence.

## Why OpenResponses?

The transition from the standard OpenAI Chat Completions API to the OpenClaw OpenResponses API provides several "superpowers" essential for a high-reliability voice instrument:

- **Stateful Session Management:** Shifts memory management from the client to the Gateway. Fletcher no longer needs to manually track and re-send conversation history; the Gateway maintains server-side sessions tied to stable session keys.
- **Item-Based Streaming:** Replaces raw token deltas with structured SSE Items and Content Parts. This allows Fletcher to semantically distinguish between `text` (for speech), `reasoning` (for thinking), and `artifacts` (for UI) without complex parsing.
- **Interaction & Turn Control:** Provides a native lifecycle (`created`, `in_progress`, `completed`, `failed`). This enables a "pondering" UI during processing and structured error feedback for better resilience.
- **Reliability for Live Environments:** In unstable mobile/5G environments, the stateful nature of OpenResponses allows for easier resumption of context and transparent error reporting compared to the "silent failure" model of stateless completions.

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

## Future Enhancements: Artifact-Aware Streams

- **Dynamic UI Push:** Leverage OpenResponses `content_part` to push Custom Artifacts (e.g., system diagnostics, code snippets) directly into the stream, anchored to the response.
- **TUI Integration:** Map `artifact` content parts to the Brutalist Drawer (Epic 07-ui-ux) for real-time dashboard population.

## The "Free Route": Native Silicon Strategy

- **Native STT/TTS Bridge:** Provide an option to use on-device STT (iOS SFSpeech / Android SpeechRecognizer) and on-device TTS (Epic 19: Local Piper) as the default "Free" tier.
- **Data-Channel-Only Voice:** This creates a "BYO-Silicon" path where zero raw audio is streamed to the server, reducing marginal costs to near-zero and providing extreme reliability in low-bandwidth (Nose Hole) environments.
- **Economic Impact:**
    - **Premium Voice (Cloud):** ~$0.042/min (Audio + Deepgram + ElevenLabs + Agent Hosting).
    - **Standard Voice (Native):** ~$0.004/min (LiveKit Cloud audio transfer only; $0 if self-hosting LiveKit server).
- **Tiered Interaction & Upsell:**
    - **Standard (Free):** Native on-device STT/TTS + OpenResponses text deltas. This is the "BYO-Silicon" path with near-zero marginal cost.
    - **Premium (Heirloom):** High-fidelity cloud STT (Deepgram) and TTS (ElevenLabs) with raw audio streaming.
    - **Native Upgrade Path:** Provide a seamless in-app toggle to "Upgrade to Premium Voice." This single purchase unlocks the "Heirloom" cloud bundle: Premium Ears (Deepgram) and Premium Mouth (ElevenLabs), providing an ultra-high-fidelity, patient-listener experience that mirrors the existing TTS quality selection.
    - **Flexible Overage Strategy:** Implement an "Allow Overages" toggle in settings. If enabled, users can continue using Premium Voice beyond their quota for a usage-based fee (with a monthly cap). If disabled, the app gracefully falls back to Standard (Native) mode when the quota is reached, ensuring zero service interruption.

## Next Steps

- [ ] Perform a live field test to verify "fail-over" behavior when the stream is interrupted.
- [ ] Monitor logs for `response.failed` events to tune retry logic.
- [ ] Update documentation for external contributors.

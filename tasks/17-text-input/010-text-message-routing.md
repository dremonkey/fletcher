# TASK-010: Implement Text Message Routing (Data Channel vs HTTP)

## Status
- **Status:** Open
- **Priority:** High
- **Owner:** Unassigned
- **Created:** 2026-03-08

## Epic
- [Epic 17: Text Input Mode](./EPIC.md)

## Open Question
Should text messages route through the LiveKit data channel (`ganglia-events` topic) or go directly to the OpenClaw HTTP API?

- **Data channel:** Keeps everything within the existing voice session. Simpler architecture, but coupled to LiveKit connection health.
- **HTTP API:** Separate, more reliable path when audio is degraded. Independent of LiveKit connection, but requires direct API integration.

## Solution
1. Decide on routing strategy (or implement both with fallback)
2. If data channel: define a new event type (e.g., `user-text-message`) in the ganglia-events protocol and send via `LiveKitService.sendDataChannelMessage()`
3. If HTTP: make a direct POST to OpenClaw completions API with the text content and session ID
4. Ensure the agent-side (Ganglia plugin) can receive and process text messages through whichever path is chosen
5. Consider fallback: try data channel first, fall back to HTTP if LiveKit is disconnected

## Acceptance Criteria
- [ ] Routing strategy decided and documented
- [ ] Text messages reach the agent/LLM through chosen path
- [ ] Agent responds to text messages using same session context as voice
- [ ] Text input works even when voice pipeline is degraded

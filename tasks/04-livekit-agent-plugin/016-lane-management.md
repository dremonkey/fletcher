# TASK-016: Explicit Turn Cancellation & Lane Management

Implement robust cancellation of in-flight turns in the Fletcher LiveKit agent to prevent "Zombie Agent" state locks during network fluctuations.

## Context
Field testing has identified a "Brain Lock" scenario (BUG-020) where network drops during an LLM request leave the OpenClaw session lane locked. The Gateway logs show `lane wait exceeded` because the previous turn never completed or timed out at the HTTP layer, causing subsequent turns to be queued indefinitely.

## Objectives
- [ ] **Request Abort:** Ensure the `OpenClawClient` in the `livekit-agent-ganglia` package properly uses `AbortController` to kill hanging `fetch` requests on interruption or reconnection.
- [ ] **Explicit Cancellation:** Implement a pre-turn "Flush" signal. Before starting a new turn, the agent should verify if a previous turn is "ghosting" and explicitly cancel it.
- [ ] **Timeout Hardening:** Set aggressive but realistic timeouts (e.g., 5-8s) for the initial LLM TTFT (Time to First Token). If exceeded, fail the turn and reset the lane.
- [ ] **Lane Monitoring:** Add logging to the Fletcher TUI to show if a turn is "Awaiting Brain" vs. "Idle."

## Technical Considerations
- **AbortSignal:** The `OpenClawChatStream` needs to pass the abort signal down to the underlying `fetch` call in `client.ts`.
- **Race Conditions:** Ensure that a "Cancel" command doesn't accidentally wipe a response that just arrived.

## Success Criteria
- Reconnecting to a session and speaking immediately unlocks the agent and results in a response.
- No more `lane wait exceeded` errors in Gateway logs after a network "nose hole."

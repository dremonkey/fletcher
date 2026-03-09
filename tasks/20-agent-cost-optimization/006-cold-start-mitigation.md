# Task 006: Cold-Start Latency Mitigation

**Epic:** 20 — Agent Cost Optimization
**Status:** [ ]
**Priority:** Medium

## Problem

When an agent is dispatched on demand after being idle, there's a cold-start penalty. The user's first utterance after idle may take 1.5-3s to get a response instead of the usual 1-1.5s. This degrades the voice-first experience.

Known issue: [GitHub Issue #3311](https://github.com/livekit/agents/issues/3311) documents agents going to "pending" status after idle periods, causing multi-second cold starts.

## Solution

Minimize cold-start latency through:
1. LiveKit agent pre-warming (`prewarm` / `num_idle_processes`)
2. Grace period before full disconnect
3. Measurement and optimization of each phase

## Investigation Areas

### 1. LiveKit `prewarm` function

The agents framework supports a `prewarm` function that runs before jobs are assigned. This pre-loads models, warms caches, and establishes connections:

```typescript
export default defineAgent({
  prewarm: async () => {
    // Pre-initialize STT/TTS/LLM connections
    // Load VAD model
    // Warm HTTP connection pools
  },
  entry: async (ctx: JobContext) => { ... },
});
```

### 2. `num_idle_processes`

Controls how many spare agent processes are kept warm:

```typescript
cli.runApp(
  new ServerOptions({
    agent: import.meta.filename,
    agentName: 'fletcher-voice',
    numIdleProcesses: 2,  // Keep 2 warm processes ready
  }),
);
```

### 3. Grace period ("warm-down")

Instead of immediately disconnecting after idle timeout, keep the agent in a low-cost "warm" state for an additional period:

- After idle timeout: disable audio input (`session.input.setAudioEnabled(false)`)
- Wait N additional minutes in this "warm" state
- If user speaks during warm-down, re-enable audio input instantly (no dispatch needed)
- If warm-down expires, fully disconnect

**Tradeoff:** This still incurs agent-minute charges during warm-down, but eliminates cold-start for users who return within the grace period.

### 4. Measurement

Instrument the dispatch-to-first-response pipeline to measure actual latency:

| Metric | Measurement Point |
|---|---|
| Dispatch latency | Time from `createDispatch()` to agent `ctx.connect()` |
| Pipeline startup | Time from `ctx.connect()` to `session.start()` complete |
| First STT result | Time from agent connect to first `UserInputTranscribed` |
| First LLM token | Normal TTFT measurement |
| Total cold-start overhead | Time from client VAD detection to first TTS audio output |

## Files to Modify

- `apps/voice-agent/src/agent.ts` — add `prewarm`, `numIdleProcesses`, warm-down logic
- `apps/voice-agent/src/metrics.ts` — add cold-start metrics

## Acceptance Criteria

- [ ] Cold-start overhead measured end-to-end
- [ ] `prewarm` function implemented (pre-loads VAD model, warms connections)
- [ ] `numIdleProcesses` configured appropriately
- [ ] Warm-down grace period implemented and configurable
- [ ] Cold-start overhead < 500ms (dispatch + connect, excluding normal STT/LLM/TTS pipeline)
- [ ] Metrics dashboard shows cold-start vs warm-start latency comparison

## Dependencies

- Task 001 (Explicit Dispatch) — `agentName` must be set
- Task 004 (Idle Timeout) — disconnect logic to extend with warm-down

## Open Questions

- What is the actual cold-start latency on LiveKit Cloud vs self-hosted? Need to measure both.
- Does `numIdleProcesses` work with LiveKit Cloud hosted agents, or only self-hosted workers?
- Is the warm-down grace period worth the cost? Need to model typical user return patterns.

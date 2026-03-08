# Task 001: Enable Preemptive Generation & Tune Endpointing

**Epic:** 05 - Latency Optimization
**Phase:** 1
**Status:** Complete ✅

## Objective

Enable the SDK's built-in `preemptiveGeneration` feature and tune endpointing delays to save 200–400ms per turn.

## Checklist

- [x] Enable `preemptiveGeneration: true` in `voiceOptions`
- [x] Set `minEndpointingDelay: 800` (up from 500ms default, BUG-014)
- [x] Set `maxEndpointingDelay: 3000` (BUG-014)
- [x] Set `minInterruptionDuration: 800` (TASK-014)
- [x] Set `minInterruptionWords: 1` (TASK-014)

## Files

- `apps/voice-agent/src/agent.ts` — `voiceOptions` block in AgentSession constructor

## Notes

Endpointing tuning was applied incrementally through BUG-014 and TASK-014 fixes.
`preemptiveGeneration` added as final piece.

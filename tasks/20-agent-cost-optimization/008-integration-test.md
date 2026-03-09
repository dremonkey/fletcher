# Task 008: Integration Test & Cost Validation

**Epic:** 20 — Agent Cost Optimization
**Status:** [ ]
**Priority:** Medium

## Problem

The full on-demand dispatch lifecycle needs end-to-end validation — from client VAD detection through dispatch, conversation, idle timeout, disconnect, and re-dispatch. We also need to confirm that agent-minute billing actually stops during idle periods.

## Test Scenarios

### 1. Happy path — full lifecycle
1. Client connects to room (no agent)
2. Local VAD detects speech
3. Client dispatches agent
4. Agent connects and responds
5. Conversation happens normally
6. User goes silent for idle timeout period
7. Agent sends idle warning
8. Agent disconnects
9. Client transitions to local VAD mode
10. User speaks again
11. Agent re-dispatched and responds

### 2. Rapid speech after idle warning
1. Agent sends idle warning (30s countdown)
2. User speaks within 30s
3. Idle timer resets, agent stays connected

### 3. Dispatch failure
1. Local VAD detects speech
2. Dispatch endpoint returns error (server down, network issue)
3. Client retries once
4. On second failure, shows error and stays in AGENT_ABSENT

### 4. Agent crash during conversation
1. Agent is in AGENT_PRESENT state
2. Agent session crashes (simulated)
3. Client detects agent departure
4. Client transitions to AGENT_ABSENT
5. User speaks again → agent re-dispatched

### 5. Network loss during dispatch
1. Local VAD detects speech
2. Client sends dispatch request
3. Network drops before response
4. Client handles timeout gracefully
5. On network restore, re-attempts dispatch

### 6. Cost validation
1. Record agent-minutes from LiveKit Cloud dashboard before test
2. Run 1-hour test: 10 min active, 50 min idle (agent disconnected)
3. Record agent-minutes after test
4. Verify ~10 minutes billed (not 60)

## Implementation

### Automated tests

Where possible, use the existing e2e test infrastructure (ADB + vision). Key scenarios to automate:
- Agent dispatch on speech (mock VAD trigger)
- Agent disconnect after idle timeout
- Re-dispatch after idle

### Manual field test

Some scenarios require real hardware:
- Local VAD accuracy in real environments (quiet room, noisy cafe, car)
- Battery impact over extended idle periods
- Cost validation against LiveKit Cloud billing dashboard

## Metrics to Capture

| Metric | Target |
|---|---|
| Dispatch-to-agent-connect latency | < 500ms |
| First response after dispatch | < 3s |
| False positive VAD triggers / hour | < 5 |
| Battery drain (idle, local VAD active) | < 3% / hour |
| Agent-minutes saved vs always-on | > 80% for mostly-idle sessions |

## Files to Create

- `apps/mobile/test/e2e/` — new e2e test scenarios for on-demand dispatch
- `docs/field-tests/` — field test log for cost validation session

## Acceptance Criteria

- [ ] All 5 test scenarios pass
- [ ] Cost validation confirms billing stops during idle periods
- [ ] Dispatch latency measured and within target
- [ ] False positive rate acceptable in real environments
- [ ] Field test completed with bug log

## Dependencies

- All prior tasks (001-007) — this is the integration test for the complete feature

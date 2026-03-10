# Task: Client-side audio buffering for network dead zones + agent dispatch

## Problem

**Two scenarios** cause the user's speech to be lost:

### Scenario A: Network dead zones (original)
When the user walks through a cellular dead zone or experiences a brief network interruption, any speech during the gap is permanently lost. The LiveKit SDK does not buffer audio locally during disconnects — audio frames are simply dropped.

**Field test reference:** [BUG-027](../../docs/field-tests/20260303-buglog.md)

**Tester said:** "I was walking around, probably entered a dead zone and what I was saying was lost. I think we need to add an audio buffering feature to make sure we don't lose stuff the user is saying even in spotty connectivity."

### Scenario B: Agent dispatch latency (new — Epic 20)
When the agent is absent (idle-disconnected, on-demand dispatch mode) and the user starts speaking, the first few seconds of speech are lost. The audio-level detection triggers dispatch, but the agent takes ~500ms-2s to connect and subscribe to the audio track. Everything the user says during that window is dropped — the agent wasn't subscribed yet.

**Field test reference:** [20260309-buglog.md](../../docs/field-tests/20260309-buglog.md)

**Tester said:** "We are losing the first few seconds of speech as the agent reconnects."

## Current State

### Scenario A: Partially implemented
- SDK `PreConnectAudioBuffer` captures mic audio during reconnection (`RoomReconnectingEvent` → `RoomReconnectedEvent`)
- Buffered audio sent to agent via `sendAudioData()` on `lk.agent.pre-connect-audio-buffer` topic
- **Remaining:** Verify agent-side handles the topic; handle deep drops across manual reconnect cycles

### Scenario B: Not implemented
- No buffering exists for the dispatch latency window
- `PreConnectAudioBuffer` cannot be reused here — it's designed for SDK reconnection events, not for "agent not yet subscribed" scenarios
- The room connection is healthy; the agent simply hasn't joined yet

## Proposed Solution for Scenario B

Capture audio locally from the moment speech is detected (dispatch trigger) until the agent connects and subscribes.

### Option 1: PreConnectAudioBuffer adaptation
Use `PreConnectAudioBuffer` during the dispatch window:
- Start recording when `AgentPresenceState` transitions to `dispatching`
- Send buffered audio when agent connects (`ParticipantConnectedEvent`)
- **Pro:** Reuses existing SDK mechanism
- **Con:** Relies on `lk.agent.pre-connect-audio-buffer` topic being handled agent-side (same dependency as Scenario A)

### Option 2: Data channel audio blob
- Capture PCM/Opus frames in a ring buffer during dispatch
- On agent connect, send the buffer via reliable data channel as a binary blob
- Agent-side handler decodes and prepends to the STT pipeline
- **Pro:** Doesn't depend on SDK topic handling; works with any agent
- **Con:** Requires custom agent-side handler; data channel has size limits

### Option 3: Replay through audio track
- Buffer raw audio frames locally during dispatch
- On agent connect, publish buffered frames through the audio track at accelerated rate before live audio resumes
- **Pro:** Agent processes it like normal audio — no special handling needed
- **Con:** Introduces brief "fast-forward" audio; may confuse VAD/STT with overlapping frames

### Recommended: Option 1
`PreConnectAudioBuffer` is already wired for Scenario A. Extending it to Scenario B unifies both code paths and requires solving the agent-side topic handler only once.

## Implementation Plan

### Phase 1: Dispatch window buffering (Scenario B)
1. In `LiveKitService`, when `AgentPresenceState` transitions to `dispatching`:
   - Create a `PreConnectAudioBuffer` and start recording
2. When `ParticipantConnectedEvent` fires (agent joins):
   - Send buffered audio via `sendAudioData()` to the agent
   - Reset the buffer
3. If dispatch fails (back to `agentAbsent`):
   - Discard the buffer

### Phase 2: Agent-side handler (both scenarios)
1. Verify whether `livekit-agents` framework auto-handles `lk.agent.pre-connect-audio-buffer` topic
2. If not, add a handler in the voice agent to receive buffered audio and feed it to the STT pipeline
3. Handle ordering: buffered audio should be processed before live audio

### Phase 3: UX indicator
- Show "Recording locally..." or similar indicator while buffering
- Relevant for both scenarios

## Edge Cases

- Buffer overflow (user talks for > buffer duration while agent dispatches — unlikely for dispatch, relevant for network drops)
- Agent dispatch fails — discard buffer, don't re-send on next dispatch
- Agent connects but immediately disconnects — don't send buffer
- Buffer from Scenario A overlaps with Scenario B (network drops during dispatch)
- Rapid dispatch cycles (user triggers dispatch, agent connects, immediately idles, user speaks again)

## Acceptance Criteria

- [x] Audio is captured locally during network interruptions (Scenario A) — via SDK `PreConnectAudioBuffer`
- [x] Buffered audio is delivered to the agent on reconnection (Scenario A) — via `sendAudioData()` on `RoomReconnectedEvent`
- [ ] Audio is captured locally during agent dispatch window (Scenario B)
- [ ] Buffered audio is delivered to the agent when it connects after dispatch (Scenario B)
- [ ] Agent processes buffered audio and responds appropriately — requires agent-side handler for `lk.agent.pre-connect-audio-buffer` topic
- [ ] UI indicates when audio is being buffered locally
- [x] Buffer has a reasonable size limit with graceful overflow handling — 10MB ring buffer in SDK, 60s timeout

## Files

- `apps/mobile/lib/services/livekit_service.dart` — audio track and connection management; dispatch buffer lifecycle
- `apps/mobile/lib/services/agent_presence_service.dart` — state transitions that trigger buffering
- Agent-side: handler for `lk.agent.pre-connect-audio-buffer` topic (or custom data channel handler)

## Priority

**High** — Critical for both outdoor/mobile use (Scenario A) and on-demand dispatch UX (Scenario B). Scenario B is the more common case now that Epic 20 is live.

## Status
- **Date:** 2026-03-09
- **Priority:** High
- **Status:** In progress — Scenario A client-side implemented; Scenario B (dispatch buffering) not started; agent-side handling not verified for either

# Task: Reliable one-shot service startup

## Description

The TUI's "Start dev services" flow is unreliable — the voice agent sometimes fails to connect to the room. This task diagnoses and fixes the issue by first establishing a known-good manual startup sequence, then aligning the TUI to match it.

## Background

The troubleshooting doc (`docs/troubleshooting/agent-not-dispatched.md`) documents a `JT_ROOM` vs `JT_PARTICIPANT` dispatch mismatch that was previously fixed (removed `agentName` from `ServerOptions`, removed `RoomAgentDispatch` from token). However, the TUI still has intermittent failures where the agent registers but never joins the room.

Possible causes:
- **Race condition:** Token is generated before LiveKit server is fully ready, or agent hasn't registered by the time the mobile client joins
- **Docker networking:** `voice-agent` container may start before `livekit` container is accepting connections, even with `depends_on`
- **Stale state:** Old tokens, cached Docker images, or leftover containers from previous runs
- **Token/room mismatch:** The room name in the token may not match what the agent expects

## Approach

### Phase 1: Document the manual step-by-step process

Write down and verify each step works in isolation:

1. **Clean slate** — `docker compose down`, kill emulator, clear stale tokens
2. **Start LiveKit server** — `docker compose up -d livekit`, wait for port 7880
3. **Start voice agent** — `docker compose up -d voice-agent`, verify registration in logs (`worker registered jobType: "JT_ROOM"`)
4. **Generate token** — `bun run scripts/generate-token.ts --room fletcher-dev`, confirm token written to `apps/mobile/.env`
5. **Launch emulator** — Start Android emulator, install/launch Flutter app
6. **Verify connection** — Agent joins room, participant detected, voice round-trip works

### Phase 2: Test with emulator

Run the manual sequence end-to-end with the Android emulator. Document what works and any issues found. Confirm that done step-by-step, the agent reliably connects.

### Phase 3: Test with physical device (Pixel 9)

Repeat Phase 2 but targeting the Pixel 9:
- Replace `localhost` with LAN IP in token's `LIVEKIT_URL`
- Verify WebRTC connectivity from physical device to local LiveKit server
- Confirm voice round-trip works

### Phase 4: Diagnose TUI issues

Compare the manual sequence against what `startServices()` in `packages/tui/src/services.ts` actually does. Look for:
- Missing health checks (is LiveKit ready before starting the agent?)
- Race conditions in parallel startup
- Token generation timing relative to service readiness
- Docker `depends_on` not waiting for actual readiness (only waits for container start, not port open)

### Phase 5: Fix the TUI

Apply fixes to make the TUI startup reliable:
- Add health check / port readiness polling before proceeding to next step
- Sequence services correctly: LiveKit ready -> agent started + registered -> token generated -> mobile launched
- Add retry logic or clear error messages for transient failures
- Verify with both emulator and physical device

## Checklist

### Phase 1: Manual process documentation
- [ ] Document clean-slate procedure
- [ ] Document step-by-step startup sequence
- [ ] Verify each step in isolation

### Phase 2: Emulator end-to-end
- [ ] Run manual sequence with emulator
- [ ] Verify agent connects to room
- [ ] Verify voice round-trip works
- [ ] Document any issues found

### Phase 3: Physical device (Pixel 9)
- [ ] Run manual sequence with Pixel 9
- [ ] Verify WebRTC connectivity with LAN IP
- [ ] Verify voice round-trip works
- [ ] Document any issues found

### Phase 4: TUI diagnosis
- [ ] Compare TUI startup code against working manual sequence
- [ ] Identify race conditions or missing health checks
- [ ] Document root cause(s)

### Phase 5: TUI fixes
- [x] Implement fixes in `packages/tui/src/services.ts`
- [ ] Test TUI one-shot startup with emulator (3+ consecutive successes)
- [ ] Test TUI one-shot startup with Pixel 9 (3+ consecutive successes)

## Success Criteria

- The TUI's "Start dev services" reliably starts all services and the agent connects to the room on every attempt
- Works with both emulator and physical device
- Clear error messages if a step fails (no silent failures)

## Current Findings

_(To be updated as investigation progresses)_

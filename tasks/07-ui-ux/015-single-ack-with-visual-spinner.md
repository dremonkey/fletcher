# TASK-015: Single Audio Ack + Visual Waiting Spinner

## Status
- **Status:** Phases 1-2 complete
- **Priority:** Medium
- **Owner:** TBD
- **Created:** 2026-03-06

## Context
Currently the agent plays a looping audio acknowledgment chime while waiting for the LLM response (thinking state). This repetition is noticeable and irritating during longer processing times — the sound repeats on a ~1.5s cycle, which becomes grating.

The desired behavior: play the ack chime **once** to confirm the agent heard the user, then switch to a **visual indicator** (spinner or animated orb state) for the remainder of the wait. Audio silence after the initial ack keeps the experience clean without abandoning feedback entirely.

## Approach

### Phase 1: Agent-side — play ack once, stop looping ✅
The ack chime is currently played via `BackgroundAudioPlayer` in a loop. Change it to play a single shot and stop.

- [x] Locate the `BackgroundAudioPlayer` ack loop in `voice-agent` (likely in the `AgentState.thinking` handler)
- [x] Replace the looping play with a one-shot play call — added `ackToneSingleShot()` generator and `createAckToneSingleShotSource()` in `ack-tone.ts`; updated `ack-sound-config.ts` to use single-shot source
- [x] Confirm the chime does not bleed into TTS playback (state machine should already guard this)

### Phase 2: Client-side — visual spinner during thinking state ✅
The Flutter app already tracks agent state via `ganglia-events` data channel. Add a visual "waiting" indicator that activates after the initial ack and holds until the agent starts speaking.

- [x] Add a spinner or animated element to the Amber Orb / main screen that activates during `thinking` state — added dedicated `_spinController` (1.5s rotation) driving a SweepGradient arc overlay on the orb
- [x] Ensure the spinner dismisses immediately when TTS begins (agent transitions to `speaking`) — spin stops and resets on any non-processing state
- [x] Design should be subtle — complement the orb rather than compete with it (dim pulse, rotating arc, etc.) — rotating amber arc gradient overlay (0.35 opacity peak)

### Phase 3: Polish
- [ ] Verify no edge cases where the chime plays multiple times (e.g., rapid re-entry into thinking state)
- [ ] Field test: confirm the single ack reads as "I heard you" without feeling like the agent froze

## Acceptance Criteria
- [ ] Audio ack plays exactly once per user turn, regardless of LLM latency
- [ ] A visual indicator is visible on-screen for the duration of the thinking/waiting period
- [ ] The spinner/indicator disappears the moment the agent begins speaking
- [ ] No audio overlap between ack chime and TTS output

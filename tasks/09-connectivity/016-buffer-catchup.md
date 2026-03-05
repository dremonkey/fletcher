# TASK-016: Fletcher Buffer Catch-Up Optimization (Accelerated Playout)

Explore and implement a mechanism to flush buffered audio faster than real-time to synchronize the conversation after a network drop.

## Context
When audio is buffered during a "nose hole," flushing it at 1x speed means the agent is perpetually behind the user until the buffer is cleared. To maintain a natural flow, the system needs to "catch up" by processing the backlog at an accelerated rate.

## Objectives
- [ ] **Research accelerated PCM delivery**: Determine if LiveKit's `AudioSource` can handle frames at >1x speed without causing jitter or transport errors.
- [ ] **Research Transcript-Only Catch-up**: Explore bypassing the audio track entirely for buffered data and sending it directly to the STT engine on the Hub to get the text immediatey.
- [ ] **Implement Dynamic Playback Speed**: If audio must be sent, evaluate if the agent can process a 1.5x or 2x speed stream to close the synchronization gap faster.
- [ ] **Define "Sync Point" logic**: Determine when the buffer is "caught up" and transition back to seamless real-time streaming.

## Success Criteria
- The conversation resynchronizes significantly faster than the duration of the network outage.
- No audio artifacts or agent confusion during the accelerated flush phase.

# TASK-004: Remote Reboot "Hail Mary" Fallback

Investigate and implement a remote reboot capability for the LiveKit server and agent worker to recover from "Zombie Agent" states or fatal pipe hangs.

## Context
During field testing (BUG-019, BUG-020), we encountered states where the voice agent becomes unresponsive or "zombified" due to network air gaps ("nose holes"). While not ideal UX, a remote reboot provides a "Hail Mary" recovery path for the user when the agent is otherwise unreachable.

## Objectives
- [ ] **Infrastructure Audit:** Determine how to trigger a restart of the LiveKit stack (Docker/systemd) remotely.
- [ ] **Trigger Mechanism:** Identify a secure way to trigger this from the OpenClaw control plane (e.g., a special slash command or WhatsApp trigger).
- [ ] **Agent Auto-Recovery:** Ensure the agent worker automatically re-registers and joins the room after a restart.
- [ ] **User Feedback:** Provide clear visual/audio feedback in the Flutter app when a reboot is initiated.

## Technical Considerations
- **Security:** Ensure the reboot trigger is restricted to authorized owners only.
- **Latency:** A full reboot takes time; investigate if a "soft restart" of the agent process is sufficient vs. a full server reboot.
- **State Persistence:** Ensure the room and participant state can recover gracefully.

## Success Criteria
- A command exists (e.g., `/fletcher reboot`) that successfully cycles the voice stack.
- The agent is back online and responsive within <30 seconds of the trigger.

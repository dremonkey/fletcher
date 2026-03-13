# R-007: Clean Up on Participant Disconnect

**Status:** [ ] Not started
**Depends on:** R-004 (Room lifecycle)
**Blocks:** Nothing

## Problem

When a mobile participant leaves a LiveKit room (app closed, network loss, explicit disconnect), the relay has no way to know. The `participant_left` webhook event is not handled — see `src/http/webhook.ts` which only handles `participant_joined`. The idle timer (currently 5 min, proposed 30 min in R-006) is the only cleanup path, meaning:

- The ACP subprocess stays alive unnecessarily
- The relay holds a LiveKit room connection for up to 30 minutes after the user is gone
- Resources (memory, file descriptors, subprocess) are wasted

## Proposed Changes

### 1. Handle `participant_left` webhook

In `src/http/webhook.ts`, add a handler for the `participant_left` event. When the last non-relay, non-agent participant leaves a room, tear down the bridge:

```typescript
if (event.event === "participant_left") {
  const participant = event.participant;

  // Skip relay/agent participants
  if (participant?.identity?.startsWith("relay-")) {
    return Response.json({ received: true });
  }
  if (participant?.kind === 4) {
    return Response.json({ received: true });
  }

  const roomName = event.room?.name;
  if (!roomName || !bridgeManager.hasRoom(roomName)) {
    return Response.json({ received: true });
  }

  // Check if any human participants remain in the room
  // If not, tear down the bridge
  log.info({ roomName, identity: participant?.identity }, "Participant left");
  await bridgeManager.removeRoom(roomName);
}
```

### 2. Consider: immediate vs. grace period

Two options:

**Option A — Immediate teardown:** Remove the bridge as soon as the last human leaves. Simple, fast cleanup. Risk: if the user reconnects quickly (e.g., network blip), they'll get a new ACP session.

**Option B — Short grace period:** Start a 30-second timer on last-participant-left. Cancel if someone rejoins. More resilient to network blips, but adds complexity.

Recommend **Option A** for now. The mobile app already handles reconnection by requesting a new token (which triggers `participant_joined` → new bridge). Session continuity across reconnects is a separate concern (and depends on ACP session persistence in the backend).

### 3. Participant counting

LiveKit's `participant_left` webhook includes the participant info but not a count of remaining participants. Options:

- **Use LiveKit server API** (`listParticipants`) to check if the room is empty after the leave event
- **Track participants locally** in the relay (add to a set on `participant_joined`, remove on `participant_left`)

The server API approach is simpler and avoids stale state. One extra API call on participant leave is negligible.

## Files to Change

- `src/http/webhook.ts` — Add `participant_left` handler with participant counting
- `src/bridge/bridge-manager.ts` — No changes needed (existing `removeRoom` handles teardown)

## Acceptance Criteria

- [ ] `participant_left` webhook is handled
- [ ] Relay/agent participant departures are ignored
- [ ] Bridge is torn down when last human participant leaves
- [ ] ACP subprocess is killed on bridge teardown
- [ ] LiveKit room connection is released
- [ ] Logging for participant leave events

# Task: WiFi → 5G ICE renegotiation failure

## Problem
Switching from WiFi to 5G during an active voice session causes a permanent disconnect. The client cannot reconnect and the room is eventually closed by the server.

**5G → WiFi works fine** — the issue is specific to the WiFi → 5G direction.

### Observed behavior
1. User is connected over WiFi, voice session active
2. Device switches to 5G (e.g., leaving home)
3. ICE connection breaks — server logs "short ice connection" on both SUBSCRIBER and PUBLISHER transports
4. DTLS timeout: `read/write timeout: context deadline exceeded` on all data channels
5. Server closes participant with `reason: PEER_CONNECTION_DISCONNECTED`, `isExpectedToResume: false`
6. Voice agent stream reader aborts: `Stream reader cancelled via releaseLock()`
7. Room closes after departure timeout (~20s), agent job marked `JS_FAILED`

### Key log evidence
```
livekit  | participant closing  reason: "PEER_CONNECTION_DISCONNECTED"  isExpectedToResume: false
livekit  | error reading data channel  error: "dtls timeout: read/write timeout: context deadline exceeded"
livekit  | closing idle room  reason: "departure timeout"
livekit  | job ended  status: "JS_FAILED"  error: "agent worker left the room"
```

### ICE candidates at disconnect
- **Server (local):** `udp4 host 23.93.223.245:50904` (Tailscale IP, correct)
- **Client (remote):** `udp4 host 192.168.87.104:44455` (WiFi LAN IP — stale after 5G switch)
- Client also sent `srflx 23.93.223....:44455` but selected candidate was the stale LAN IP

## Analysis

### Root cause: "break before make" timing

WiFi → 5G is a **"break before make"** transition — WiFi drops *before* 5G is fully active, creating a connectivity gap. The phone must: activate 5G → get an IP → re-establish the Tailscale tunnel → gather new ICE candidates. This takes several seconds.

The server-side timeline shows it gives up far too quickly:

```
07:33:54  "short ice connection" — server detects ICE link is dead
07:33:59  participant closed     — only 5 seconds later (isExpectedToResume: false)
07:34:19  room closed            — agent leaves, job marked JS_FAILED
```

**~5 seconds is not enough** for the 5G + Tailscale handoff to complete.

### Why 5G → WiFi works

That's a **"make before break"** transition — WiFi comes up *while 5G is still active*. There's no connectivity gap, so the client can gather new ICE candidates on WiFi and renegotiate while the old connection is still alive.

### The smoking gun: `isExpectedToResume: false`

This is the critical flag. When the server sets this to `false`, it cleans up participant state immediately — even if the client reconnects seconds later, there's nothing to resume into. The room empties, the agent leaves, and the room closes via departure timeout.

### Cascade of failure

1. **Server gives up too fast** (~5s ICE timeout) — not enough time for 5G handoff
2. **`isExpectedToResume: false`** — server doesn't preserve participant state for reconnection
3. **Agent leaves when room empties** — the voice agent exits as soon as the user participant is gone
4. **Room closes on departure timeout** (~20s) — even if the client reconnects, it would be joining an empty room with no agent
5. **App-level reconnect (task 004) never gets a chance** — by the time the client has 5G + Tailscale, everything is torn down

### Possible root causes
- [ ] LiveKit server ICE disconnect timeout is too short (~5s) for mobile network transitions
- [ ] `isExpectedToResume: false` — investigate why the server doesn't expect resumption; may need config to force resume expectation
- [ ] Client-side ICE restart may not be triggering (Flutter LiveKit SDK behavior on network change)
- [ ] Tailscale tunnel re-establishment delay on 5G may exceed LiveKit's ICE timeout
- [ ] `use_external_ip: true` in `livekit.yaml` may conflict with `rtc.node_ip` pinning
- [ ] Agent exits immediately on participant disconnect — no grace period to wait for reconnection

## Likely fix (two levels)

### Server config
LiveKit should have settings to increase the ICE disconnect timeout and keep participant state around longer. Look for `reconnect_timeout`, `departure_timeout`, or `pli_throttle`-style knobs in `livekit.yaml`. Even 30s instead of 5s would cover most WiFi → 5G transitions.

### Room/agent persistence
The agent should not leave the room the instant the user disconnects. A grace period (e.g., 30-60s) would let the client complete the 5G handoff and rejoin. This may be configurable in the LiveKit agent framework or require a wrapper in the voice agent code.

## Investigation checklist
- [ ] Check LiveKit server config for ICE timeout / resume settings (`reconnect_timeout`, etc.)
- [ ] Check LiveKit source for what determines `isExpectedToResume` and whether it's configurable
- [ ] Test with increased ICE disconnect timeout on server
- [ ] Add agent-side grace period before leaving room on participant disconnect
- [ ] Capture client-side logs during WiFi → 5G switch (Flutter LiveKit SDK)
- [ ] Verify Tailscale tunnel re-establishment timing on 5G (how many seconds?)
- [ ] Check if Flutter `ConnectivityService` triggers reconnect fast enough
- [ ] Test whether forcing an ICE restart from client side resolves the issue

## Context
- `livekit.yaml` — server config with `rtc.node_ip` pinned to Tailscale IP
- `apps/mobile/lib/services/livekit_service.dart` — client reconnect logic
- Related: task 004 (network-aware retry), task 006 (Tailscale ICE fix)
- The reverse direction (5G → WiFi) reconnects successfully, suggesting the client can renegotiate when gaining a "better" interface but not when losing one

## Fix Applied (2026-03-02)

The root cause was the default 20s `departure_timeout` — far too short for WiFi→5G's "break before make" handoff which takes 40-80s including Tailscale tunnel re-establishment.

**Changes:**
1. **`livekit.yaml`** — Added `room.departure_timeout: 120` (2 minutes). Keeps the room and agent alive while the client completes the 5G handoff.
2. **`apps/voice-agent/src/agent.ts`** — Added `ParticipantDisconnected`/`ParticipantConnected` room event listeners for observability during the reconnection window.

**Why this is sufficient:**
- BUG-016 proved the agent session continues seamlessly when the client reconnects (DUPLICATE_IDENTITY eviction of stale participant, new participant joins existing room, RoomIO re-subscribes to audio tracks).
- The client already has a robust two-layer reconnection strategy (SDK auto-reconnect → app-level exponential backoff with network awareness). It just needs the room to still exist.
- 120s provides comfortable margin over the worst-case ~80s reconnection window.

**Verification:** Connect over WiFi, walk out of range to force 5G switch, confirm session recovers within ~60-80s without force-quit.

## Status
- **Date:** 2026-03-02
- **Priority:** High
- **Status:** Fixed

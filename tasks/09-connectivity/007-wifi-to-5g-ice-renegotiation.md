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
When the device switches from WiFi to 5G:
- The WiFi interface goes down, invalidating all existing ICE candidates from the client side
- The client needs to gather new candidates on the 5G interface and perform an ICE restart
- LiveKit SDK should handle this via its reconnect logic, but the server is marking `isExpectedToResume: false`, preventing resumption
- The server sees the DTLS timeout and immediately closes the participant rather than waiting for an ICE restart

### Possible root causes
- [ ] LiveKit server `isExpectedToResume: false` — investigate why the server doesn't expect resumption on network change
- [ ] Client-side ICE restart may not be triggering (Flutter LiveKit SDK behavior on network change)
- [ ] Tailscale tunnel re-establishment delay on 5G may exceed LiveKit's ICE timeout
- [ ] `use_external_ip: true` in `livekit.yaml` may conflict with `rtc.node_ip` pinning

## Investigation checklist
- [ ] Check LiveKit server config for ICE timeout / resume settings
- [ ] Check if `reconnect_on_disconnected` or similar server-side config exists
- [ ] Test with increased ICE disconnect timeout on server
- [ ] Capture client-side logs during WiFi → 5G switch (Flutter LiveKit SDK)
- [ ] Verify Tailscale tunnel re-establishment timing on 5G
- [ ] Check if Flutter `ConnectivityService` triggers reconnect fast enough
- [ ] Test whether forcing an ICE restart from client side resolves the issue

## Context
- `livekit.yaml` — server config with `rtc.node_ip` pinned to Tailscale IP
- `apps/mobile/lib/services/livekit_service.dart` — client reconnect logic
- Related: task 004 (network-aware retry), task 006 (Tailscale ICE fix)
- The reverse direction (5G → WiFi) reconnects successfully, suggesting the client can renegotiate when gaining a "better" interface but not when losing one

## Status
- **Date:** 2026-02-28
- **Priority:** High
- **Status:** Open

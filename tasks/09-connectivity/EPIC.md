# Epic: Network Connectivity & Resilience (09-connectivity)

Make voice sessions survive real-world network conditions — WiFi/cellular handoffs, Tailscale tunnel drops, Bluetooth audio rerouting, and background/foreground transitions — so the user never has to manually reconnect or lose conversation context.

## Context

Fletcher runs over LiveKit WebRTC through a Tailscale tunnel. In the field, connections break constantly: the phone switches from WiFi to 5G, Tailscale re-establishes its tunnel (40–80s), Bluetooth headsets disconnect mid-sentence, and Android kills the mic when the app is backgrounded. Each failure mode needs its own detection and recovery strategy. This epic works from the inside out: first make the SDK/UI aware of disconnects, then add intelligent retry logic, then handle the harder edge cases (audio buffering across dead zones, background lifecycle).

## Tasks

### Phase 1: Foundation — Detect & Communicate ✅

- [x] **001: SDK Reconnection Events** — Hook LiveKit SDK reconnection events; show "Reconnecting..." UI immediately instead of a 40s black hole.
- [x] **002: Disconnect Reason Filtering** — Classify disconnect reasons; don't retry after client-initiated or unrecoverable disconnects.
- [x] **003: Connectivity Monitoring** — Add `connectivity_plus` to track online/offline state on the device.

### Phase 2: Intelligent Retry ✅

- [x] **004: Network-Aware Retry** — Pause reconnection attempts while offline; resume when the network comes back.
- [~] **005: State Preservation** — Transcript history, artifacts, and mute state survive reconnections. Code audit done; test coverage incomplete.
- [x] **017: Time-Budgeted Reconnect** — Extend retry window to 130s to match the server's `departure_timeout` instead of a fixed 5 attempts.

### Phase 3: Tailscale & ICE ✅

- [x] **006: Tailscale ICE Negotiation Fix** — Pin server Tailscale IP for ICE advertisements to fix WiFi→5G failures.
- [x] **007: WiFi-to-5G ICE Renegotiation** — Handle break-before-make transitions via 120s `departure_timeout`.
- [~] **008: Tailscale URL Resolution** — Detect Tailscale on-device and use Tailscale URL. Implementation done but Android 11+ detection broken; superseded by 018.
- [x] **018: URL Resolver VPN Detection** — Replacement for 008; reliable Tailscale URL resolution on Android 11+.

### Phase 4: Audio Route Recovery ✅

- [x] **009: Bluetooth Audio Route Recovery** — Recover audio input on BT connect/disconnect via `restartTrack()`.
- [x] **011: Network Transition Audio Track Timeout** — Fix 55s audio track publish timeout on WiFi→cellular that disrupts BT routing.
- [x] **012: Foreground Service Microphone** — Android foreground service prevents mic silencing when backgrounded.

### Phase 5: Audio Buffering

- [~] **013: Client Audio Buffering** — Buffer user speech during network dead zones; replay on reconnection. Client-side buffer implemented; agent-side handler not yet verified.
- [ ] **016: Buffer Catchup** — Flush buffered audio faster than real-time to catch up after a dead zone.

### Phase 6: Diagnostics & Lifecycle

- [ ] **010: Diagnostics Stale After Reconnect** — Fix diagnostics panel showing "no agent" after DUPLICATE_IDENTITY reconnection.
- [x] **019: Background Session Timeout** — Disconnect after 10 min backgrounded (unless screen locked) to save battery.

### Phase 7: Data Channel & Network Transition Resilience

- [ ] **092: Background Resume Token Retry** — `onAppResumed()` calls `connectWithDynamicRoom()` once; WiFi not ready after deep sleep; add 3-attempt retry. (BUG-044)
- [ ] **093: Ghost Data Channel After Reconnect** — `RoomReconnectedEvent` never re-validates relay binding; add re-bind, prompt timeout, heartbeat. (BUG-045)
- [ ] **094: Network Switch Mic Grab + Stuck Room** — `PreConnectAudioBuffer` unconditionally grabs mic in chat mode; no retry after `_connectToNewRoom()` failure; `ConnectivityService` blind to interface switches. (BUG-046)

## Status Summary

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Detect & Communicate | ✅ Complete |
| 2 | Intelligent Retry | ✅ Mostly complete (005 tests remaining) |
| 3 | Tailscale & ICE | ✅ Complete |
| 4 | Audio Route Recovery | ✅ Complete |
| 5 | Audio Buffering | In progress (013 partial, 016 not started) |
| 6 | Diagnostics & Lifecycle | Partial (010 not started, 019 done) |

## Dependencies

- **LiveKit server config** (`livekit.yaml`): `departure_timeout: 120s` is load-bearing for tasks 007 and 017.
- **Epic 10 (Metrics):** Latency and reconnection telemetry feeds diagnostics (010).
- **Epic 13 (Edge Intelligence):** On-device buffering (013/016) may interact with edge VAD/STT if that lands.

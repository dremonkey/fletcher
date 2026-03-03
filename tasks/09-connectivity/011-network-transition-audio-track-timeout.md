# Task: Fix 55-second audio track publish timeout on WiFi→cellular transition

## Problem

When the phone transitions from WiFi to cellular while a voice session is active, the audio track takes 55 seconds to re-publish. During this window, Bluetooth audio routing is disrupted (drops to speaker), the user hears nothing, and must manually toggle Bluetooth to recover.

**Field test references:**
- [BUG-021 (03-03)](../../docs/field-tests/20260303-buglog.md) — 55s audio track timeout, BT audio disruption
- Related: [BUG-015](../../docs/field-tests/20260302-buglog.md) (WiFi→5G session kill, fixed via departure_timeout)
- Related: [BUG-017](../../docs/field-tests/20260301-buglog.md) (BT audio route changes)

## Investigation

### Theory 1: Flutter SDK creates new session instead of ICE restart

**Hypothesis:** The SDK should renegotiate ICE on the existing connection but instead creates a new participant.

**Verified against LiveKit server logs** (`docs/field-tests/20260303-livekit-1653-1710.txt`):

WiFi connection (line 1): `"Reconnect": false`, `"network": "wifi"`, pID `PA_wHEgiBerEQS2`
Cellular connection (line 12): `"Reconnect": false`, `"network": "cellular"`, pID `PA_7Myx4r3bzxiF`

Both show `"Reconnect": false` — the SDK is creating a brand-new participant each time, not doing an ICE restart on the existing connection. The server kills the old participant with `DUPLICATE_IDENTITY` (line 11).

**Conclusion:** Confirmed. The Flutter LiveKit SDK (v2.5.4) creates new participants on network interface changes rather than performing ICE restart. This is SDK-level behavior we cannot change.

### Theory 2: The 55s delay is Tailscale tunnel re-establishment

**Hypothesis:** The media transport (DTLS/SRTP) can't complete because the Tailscale WireGuard tunnel hasn't re-established on cellular yet.

**Verified against ICE candidate comparison:**

**WiFi (16:53:50, line 3):**
- Selected local (server): `udp4 host 23.93.223.245:59488` — server IP
- Selected remote (client): `udp4 host 192.168.87.104:46168` — client LAN IP
- Connect time: **503ms**
- Path: direct LAN (client WiFi → server on same network)

**Cellular (16:55:07, line 17):**
- Selected local (server): `udp6 host [fd7a:115c:a1e0::8401:db8b]:55063` — Tailscale IPv6 ULA
- Selected remote (client): `udp6 prflx fd7a:115c:a1e0::8c01:2391:42495` — Tailscale IPv6 peer-reflexive
- Connect time: **1.9s**
- Path: Tailscale tunnel (client cellular → WireGuard → server Tailscale)

The cellular connection selected Tailscale IPv6 on both ends. The `prflx` (peer-reflexive) candidate type means the address was discovered during connectivity checks, consistent with the Tailscale tunnel being established mid-handshake.

**Key evidence — track ID mismatch:**
- Supervisor timeout at 16:55:38 for track `TR_AMLh7DykUngWDV` (line 18)
- Track published at 16:56:00 was `TR_AMHBDF7Tn6BSdD` — a **different track** (line 23)

This means the first track publish attempt failed after 33s (DTLS timeout), and the SDK retried with a new track that succeeded 22s later. Total: 55s.

**Confirmation — second transition is fast:**
- Transition #2 at 16:58:44: `onTrackSubscribed` at 16:58:47 — **3 seconds**
- The Tailscale tunnel was already established from transition #1, so no re-establishment delay.

**Conclusion:** Confirmed. The 55s delay is caused by:
1. Tailscale WireGuard tunnel re-establishment on cellular (30-40s)
2. First DTLS handshake times out during tunnel establishment (~33s)
3. SDK retries track publish with new track, succeeds after tunnel is ready (~22s later)

### Theory 3: BT audio disruption is caused by the audio session teardown

**Hypothesis:** When the old track is unpublished, Android tears down BT SCO. During the 55s gap, there's no active audio session, so Android falls back to speaker.

**Verified against voice-agent logs** (`docs/field-tests/20260303-voice-agent-1653-1710.txt`):

Line 363: `[16:55:08] ERROR: Stream reader cancelled via releaseLock()` — old track unpublished
Line 397: `[16:56:00.355] onTrackSubscribed` — new track ready

55-second gap with no audio track. During this window:
- Android releases BT SCO (no active audio session using it)
- Audio routes to speaker (default fallback)
- When track re-publishes, BT SCO doesn't auto-restore on all devices

**Conclusion:** Confirmed. The BT audio disruption is a direct consequence of the 55s publish gap.

### Final Root Cause

**Primary cause:** Tailscale WireGuard tunnel re-establishment on cellular network takes 30-55 seconds. During this time, DTLS handshakes for the media transport fail and retry, causing a 55-second audio track publish timeout.

**Contributing factors:**
1. **SDK behavior (not fixable):** Flutter LiveKit SDK creates new participants on network change instead of ICE restart → DUPLICATE_IDENTITY
2. **Tailscale routing (inherent):** `livekit.yaml` pins `node_ip: 100.87.219.109` (Tailscale IP), forcing all media through Tailscale tunnel
3. **No foreground service:** Without `FOREGROUND_SERVICE_MICROPHONE`, Android may additionally hinder audio capture during background/transition states
4. **No audio route preservation:** After track re-publishes, BT SCO is not explicitly re-established

**The cascade:**
1. WiFi drops → phone transitions to cellular
2. SDK creates new participant on cellular (DUPLICATE_IDENTITY kills old)
3. Signaling connects quickly (1.9s, TCP/WebSocket through Tailscale DERP)
4. Media transport can't connect (UDP through WireGuard tunnel, not yet ready)
5. First DTLS handshake times out at 33s → supervisor `publish time out`
6. SDK retries with new track → succeeds at 55s (tunnel now established)
7. Old audio track was unpublished at 16:55:08 → Android releases BT SCO
8. 55s gap with no audio → speaker fallback
9. Track publishes at 16:56:00 → audio resumes, but on speaker not BT
10. User must manually toggle BT to restore SCO

## Proposed Fix

This is a multi-layer problem. No single fix eliminates the 55s delay (that's Tailscale's WireGuard re-establishment timing), but we can significantly reduce user impact.

### Fix 1: Re-establish BT audio route after track re-publishes (client)

After a reconnection completes and the audio track is re-published, explicitly request BT SCO re-establishment.

**File:** `apps/mobile/lib/services/livekit_service.dart`
**Location:** After `RoomReconnectedEvent` handler (line 189)

```dart
_listener?.on<RoomReconnectedEvent>((_) {
  debugPrint('[Fletcher] SDK reconnected successfully');
  _reconnectAttempt = 0;
  _reconnecting = false;
  healthService.updateRoomConnected(connected: true);
  _updateState(
    status: _isMuted ? ConversationStatus.muted : ConversationStatus.idle,
  );

  // After reconnection, refresh audio track to restore BT routing.
  // Network transitions (WiFi→cellular) tear down the old audio session,
  // causing Android to fall back to speaker. restartTrack() re-establishes
  // the correct audio route (BT SCO if headset is connected). (BUG-021)
  _refreshAudioTrack();
});
```

This reuses the existing `_refreshAudioTrack()` method (line 539) which calls `restartTrack()` — the same mechanism that fixed BUG-004 (task 009). The debounce and guard logic in `_refreshAudioTrack()` prevent double-execution.

### Fix 2: Add Android foreground service for microphone (BUG-022, separate task)

A foreground service with `FOREGROUND_SERVICE_MICROPHONE` type would:
- Maintain audio focus during network transitions
- Prevent Android from silencing the mic in background
- Help BT SCO persist across session recreation

This is a separate, larger change — tracked as BUG-022.

### Fix 3: Show appropriate UI feedback during the transition (client)

Currently the user sees no indication of what's happening during the 55s gap. The SDK fires `RoomReconnectingEvent` but the track publish delay happens AFTER the signaling reconnects.

**File:** `apps/mobile/lib/services/livekit_service.dart`

After `TrackUnsubscribedEvent` (line 238), check if we're in a reconnecting state and keep the reconnecting UI until the track is re-subscribed:

```dart
_listener?.on<TrackUnsubscribedEvent>((event) {
  debugPrint('[Fletcher] Track unsubscribed: ${event.track.kind} from ${event.participant.identity}');
  // If this is the agent's audio track being unsubscribed during a transition,
  // keep the reconnecting state visible until re-subscribed. (BUG-021)
  if (event.track.kind == TrackType.AUDIO) {
    _updateState(status: ConversationStatus.reconnecting);
  }
});
```

## Edge Cases

1. **BT not connected:** `_refreshAudioTrack()` is a no-op when BT isn't connected (restartTrack picks up whatever device is active). Safe.

2. **Multiple rapid transitions:** The debounce in `_onDeviceChange()` (2s) and the `_isRefreshingAudio` guard prevent concurrent restartTrack calls. The `RoomReconnectedEvent` handler would also trigger `_refreshAudioTrack()` which has the same guards.

3. **Track not yet published when restartTrack fires:** `_refreshAudioTrack()` checks `publication?.track != null` (line 554) — if track isn't ready yet, it's a no-op. On the next `TrackSubscribedEvent` the audio will be correct because it's a fresh track.

4. **Tailscale not in use:** If the server is on LAN (not Tailscale), the publish delay would be much shorter (1-3s like transition #2). The fix is still safe — `_refreshAudioTrack()` is lightweight.

5. **User muted during transition:** `_refreshAudioTrack()` checks `!_isMuted` (line 554) — respects mute state.

## Acceptance Criteria

- [ ] After WiFi→cellular transition, BT audio is restored automatically (no manual toggle)
- [ ] UI shows "Reconnecting..." during the full transition (not just signaling)
- [ ] After track re-subscribes, agent can hear user speech within 2s
- [ ] Second transition (cellular→cellular) remains fast (< 5s)
- [ ] BT toggle during transition doesn't cause crash or state corruption
- [ ] Field test: walk out of WiFi range, confirm audio resumes on BT after transition

## Files

- `apps/mobile/lib/services/livekit_service.dart` — BT audio restoration + UI feedback
- (Future) `apps/mobile/android/app/src/main/AndroidManifest.xml` — foreground service (BUG-022, separate task)

## Status
- **Date:** 2026-03-03
- **Priority:** High
- **Status:** Not started

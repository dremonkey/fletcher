# Task 041: Fix SDK ICE Reconnect Loop After Agent Idle Disconnect

**Epic:** 09 — Connectivity / Connection Resilience
**Status:** Implemented — all 5 fixes applied
**Priority:** High
**Origin:** Field test BUG-010 (2026-03-10)

## Problem

After the agent goes idle (warm-down expired, 45s timeout in test config), the LiveKit
SDK starts cycling through ICE disconnects roughly every 25-32 seconds. The SDK log shows:

```
SDK reconnect attempt 1/10 → reconnected successfully
  [25-32s later]
SDK reconnect attempt 1/10 → reconnected successfully
  ...
```

Three separate occurrences were observed in the same session:
- 16:44:27 — SDK reconnect AND agent departure happened simultaneously. No "reconnected
  successfully" logged. `Unmute while agent absent — triggering dispatch` at 16:45:05
  showed the room was technically alive, but agent dispatch didn't fire. Tester killed
  app at 16:45:59.
- 16:50:44 — Two simultaneous `SDK reconnect attempt 1/10` events 730ms apart (duplicate
  reconnect handler?). No success logged. App silently recovered by 16:52:24.
- 16:53:43 — Back-to-back ICE drops 25s apart. SDK recovered both times but UI stuck;
  tester force-quit at 16:55:40.

## Symptoms

1. Repeated ICE drops after agent idle disconnect (every ~25s)
2. Duplicate `SDK reconnect attempt 1/10` events in the same sequence
3. UI appears stuck in "Reconnecting…" even after SDK reports success
4. When agent departure coincides with SDK reconnect, agent dispatch may not re-fire

---

## Root Cause Analysis

### Symptom 1: Repeated ICE drops every ~25s after agent departure

**Root cause: `_refreshAudioTrack()` inside `RoomReconnectedEvent` triggers a new ICE
renegotiation cycle via `restartTrack()`, which itself causes a device-change event.**

**Code path:**

`RoomReconnectedEvent` handler (`livekit_service.dart:486-533`):
```dart
_listener?.on<RoomReconnectedEvent>((_) async {
  debugPrint('[Fletcher] SDK reconnected successfully');
  _reconnectScheduler.reset();
  _reconnecting = false;                        // ← cleared BEFORE refresh
  ...
  _updateState(
    status: _isMuted ? ConversationStatus.muted : ConversationStatus.idle,
  );
  ...
  _refreshAudioTrack();                         // ← called unconditionally
});
```

`_refreshAudioTrack()` (`livekit_service.dart:1014-1038`):
```dart
Future<void> _refreshAudioTrack() async {
  if (_isRefreshingAudio || _localParticipant == null) return;
  _isRefreshingAudio = true;
  ...
  final track = publication?.track;
  if (track != null && !_isMuted) {
    await track.restartTrack();               // ← calls stop() + getUserMedia()
  }
  ...
  _isRefreshingAudio = false;
}
```

`restartTrack()` (`pub-cache/livekit_client-2.5.4/lib/src/track/local/local.dart:197-244`):
```dart
Future<void> restartTrack([LocalTrackOptions? options]) async {
  ...
  await stop();                               // ← stops existing AudioRecord
  final newStream = await LocalTrack.createStream(currentOptions);  // ← new getUserMedia()
  ...
  await sender?.replaceTrack(newTrack);       // ← ICE renegotiation
}
```

On Android, `getUserMedia()` (called inside `createStream()`) causes the OS to re-enumerate
audio devices and fires a `devicechange` event via `Hardware._onDeviceChange` →
`Hardware.instance.onDeviceChange.add(devices)` (`hardware.dart:196-201`). The
`_subscribeToDeviceChanges()` listener (`livekit_service.dart:991-996`) catches this:

```dart
_deviceChangeSub = Hardware.instance.onDeviceChange.stream.listen((_) {
  _onDeviceChange();
});
```

`_onDeviceChange` checks the guard (`livekit_service.dart:1000`):
```dart
if (_isRefreshingAudio || _reconnecting || _room == null) { return; }
```

But `_reconnecting` was cleared to `false` at line 489 **before** `_refreshAudioTrack()`
was called, and `_isRefreshingAudio` becomes `false` again at line 1036 after the track
restart completes. So when `getUserMedia()` fires a new `devicechange` event during or
after the restart, the guard passes, the 2-second debounce starts, and another
`_refreshAudioTrack()` runs — which calls `restartTrack()` again, which triggers yet
another `devicechange`, and so on.

**The ~25-32 second cycle matches:**
- ~1s `await Future.delayed(const Duration(seconds: 1))` inside `_refreshAudioTrack`
- ~2s debounce timer in `_onDeviceChange`
- `track.restartTrack()` async duration (~1-5s on Android)
- ICE renegotiation time from `replaceTrack()` (~5-15s depending on STUN/TURN)
- Total: ~10-25s for each restart → new devicechange → 2s debounce → next restart → ICE

**Supporting evidence:** In Occurrence 3 (16:53), both reconnect cycles show the identical
sequence: `SDK reconnected successfully` → immediately `Audio device changed — refreshing
audio track` → 25s later, another ICE drop starts. This is the device change loop.

**Note on single-participant rooms:** The LiveKit server may also have a role. When the
room drops to a single participant (after agent departure), the server sends no audio
streams, reducing DTLS/SRTP activity. Some STUN keep-alive implementations require
bidirectional activity; the silence may accelerate ICE keep-alive failures. However, the
25s cycle regularity more strongly implicates the `restartTrack` loop above. The server
angle requires log access to confirm and is secondary.

---

### Symptom 2: Duplicate `SDK reconnect attempt 1/10` events (730ms apart)

**Root cause: `handleReconnect()` in the SDK engine has no concurrent-call guard and is
called twice when both the subscriber and publisher peer connections transition to
`disconnected`/`failed` simultaneously.**

`Engine.handleReconnect()` is called from two independent callback paths
(`pub-cache/livekit_client-2.5.4/lib/src/core/engine.dart:622-645`):
```dart
subscriber?.pc.onConnectionState = (state) async {
  ...
  if (state.isDisconnected() || state.isFailed()) {
    await handleReconnect(state.isFailed()
        ? ClientDisconnectReason.peerConnectionFailed
        : ClientDisconnectReason.peerConnectionClosed);   // ← path 1
  }
};

publisher?.pc.onConnectionState = (state) async {
  ...
  if (state.isDisconnected() || state.isFailed()) {
    await handleReconnect(state.isFailed()
        ? ClientDisconnectReason.peerConnectionFailed
        : ClientDisconnectReason.peerConnectionClosed);   // ← path 2
  }
};
```

`handleReconnect()` (`engine.dart:932-975`) emits the event BEFORE any guard:
```dart
Future<void> handleReconnect(ClientDisconnectReason reason) async {
  if (_isClosed) { return; }                         // only guard is _isClosed

  _isReconnecting = true;

  if (reconnectAttempts == 0) {
    reconnectStart = DateTime.timestamp();
  }

  if (reconnectAttempts! >= _reconnectCount) { ... }

  final delay = defaultRetryDelaysInMs[reconnectAttempts!];

  events.emit(EngineAttemptReconnectEvent(           // ← emitted BEFORE attemptingReconnect is set
    attempt: reconnectAttempts! + 1,
    maxAttempts: _reconnectCount,
    nextRetryDelaysInMs: delay,
  ));
  ...
}
```

The `attemptingReconnect` guard only exists inside `attemptReconnect()` (which runs after
a timer delay), not in `handleReconnect()` itself. When both peer connections disconnect
near-simultaneously (a common ICE failure mode where DTLS runs over a shared network
interface), both `onConnectionState` callbacks fire within milliseconds of each other.
Both calls reach `events.emit(EngineAttemptReconnectEvent(attempt: 1, ...))` before
`reconnectAttempts` is incremented (it's only incremented inside `attemptReconnect` at
line 1020, which hasn't run yet), producing two identical `attempt=1` events 730ms apart.

Each `EngineAttemptReconnectEvent` is forwarded by `Room.dart:559-562` to the app as a
`RoomAttemptReconnectEvent`, producing the observed duplicate log:
```
16:50:44.978 SDK reconnect attempt 1/10 (next retry in 0ms)
16:50:45.708 SDK reconnect attempt 1/10 (next retry in 0ms)
```

**This is a LiveKit SDK bug (livekit_client 2.5.4).** The app cannot fully prevent it, but
can suppress the duplicate log or add a debounce at the app layer.

---

### Symptom 3: UI stuck in "Reconnecting…" after `SDK reconnected successfully`

**Root cause: `_refreshAudioTrack()` (called from `RoomReconnectedEvent`) triggers another
ICE cycle via `restartTrack()`, which causes a `TrackUnsubscribedEvent` from the remote
side, which sets the UI back to `reconnecting` — overwriting the `idle/muted` state that
`RoomReconnectedEvent` just set.**

The sequence:

1. `RoomReconnectedEvent` fires → sets status to `idle/muted` (line 502-504) ✓
2. `_refreshAudioTrack()` called → `restartTrack()` starts ICE renegotiation
3. During ICE renegotiation, the agent's audio track subscription is temporarily lost →
   `TrackUnsubscribedEvent` fires for the remote audio track
4. `TrackUnsubscribedEvent` handler (`livekit_service.dart:632-650`):
```dart
_listener?.on<TrackUnsubscribedEvent>((event) {
  if (event.track.kind == TrackType.AUDIO) {
    final isIntentionalDisconnect = agentPresenceService.enabled &&
        (agentPresenceService.state == AgentPresenceState.idleWarning ||
            agentPresenceService.state == AgentPresenceState.agentAbsent);
    if (!isIntentionalDisconnect) {
      _updateState(status: ConversationStatus.reconnecting);   // ← overwrites idle
    }
  }
});
```
5. After agent idle disconnect, `agentPresenceService.state` is `agentAbsent` →
   `isIntentionalDisconnect = true` → the guard fires correctly, **but only if the agent
   is truly absent**. If the ICE drop happens while a new agent is already present (the
   SDK reconnected the WebRTC transport but a new agent joined during the cycle), the
   guard may not catch it.

However, there is a second path that re-enters `reconnecting` state even when no agent is
present. The `_updateAudioLevels()` loop (`livekit_service.dart:1076-1176`) runs every
100ms. Inside it, at line 1120-1125:
```dart
if (_isMuted) {
  newStatus = ConversationStatus.muted;
} else if (_state.status == ConversationStatus.error ||
    _state.status == ConversationStatus.reconnecting) {
  // Keep error/reconnecting state             // ← sticky state
```
This `Keep error/reconnecting state` branch means that once `reconnecting` is written by
`RoomReconnectingEvent` or `TrackUnsubscribedEvent`, it is preserved indefinitely by
`_updateAudioLevels()` — it will NOT self-clear on the next audio poll. Only an explicit
`_updateState(status: muted/idle)` can clear it. If the second ICE drop arrives before
the `RoomReconnectedEvent` of the first cycle clears the status, the UI will oscillate
between `reconnecting` (persistent) and `idle` (briefly), and can land permanently in
`reconnecting` if the `RoomReconnectedEvent` fires while `_isRefreshingAudio = true`.

Specifically: if `_refreshAudioTrack()` is still running (e.g., awaiting the 1s delay or
`restartTrack()`) when the second cycle's `RoomReconnectingEvent` fires, the second cycle
sets `reconnecting` again. When the first cycle's `_refreshAudioTrack()` finishes (no
state update on completion), the status remains `reconnecting` from the second cycle.
The second cycle's `RoomReconnectedEvent` would clear it, but if the second cycle also
triggers a third ICE drop, the loop continues indefinitely.

---

### Symptom 4: Agent dispatch fails when agent departure and ICE reconnect coincide

**Root cause: `toggleMute()` dispatches the agent unconditionally without checking whether
the room is currently in the `reconnecting` state.**

`toggleMute()` (`livekit_service.dart:1178-1213`):
```dart
} else {
  _updateState(status: ConversationStatus.idle);
  // Unmuting while the agent is absent is a strong intent signal —
  if (agentPresenceService.enabled &&
      agentPresenceService.state == AgentPresenceState.agentAbsent) {
    debugPrint('[Fletcher] Unmute while agent absent — triggering dispatch');
    agentPresenceService.onSpeechDetected();     // ← dispatch fires here
  }
  await _localParticipant?.setMicrophoneEnabled(true);
}
```

There is no check for `_state.status == ConversationStatus.reconnecting` or
`_reconnecting == true`. When the agent departs AND the ICE is mid-reconnect (as in the
16:44 case: agent departed at 16:44:27 during an active SDK reconnect), the sequence is:

1. ICE drop starts → `RoomReconnectingEvent` → status = `reconnecting`
2. Agent departs → `ParticipantDisconnectedEvent` → `agentPresenceService.onAgentDisconnected()`
   → `agentPresenceService.state = agentAbsent`
3. SDK still reconnecting (WebSocket + ICE not yet restored)
4. User unmutes at 16:45:05 → `toggleMute()` → sees `agentAbsent` state → calls
   `agentPresenceService.onSpeechDetected()` → `_dispatchAgent()` called
5. `_dispatchAgent()` calls `_dispatchService.dispatchAgent(roomName: _roomName!)`
6. Dispatch HTTP call reaches the LiveKit server, which attempts to assign an agent to
   the room — but the room's WebSocket connection is still in reconnect state. The server
   may reject the dispatch or the agent joins successfully but then can't establish tracks
   because the subscriber peer connection isn't ready yet.
7. `AgentPresenceService._dispatchAgent()` (`agent_presence_service.dart:217-241`):
```dart
Future<void> _dispatchAgent() async {
  ...
  final result = await _dispatchService.dispatchAgent(roomName: _roomName!);
  if (result.isDispatched || result.isAlreadyPresent) {
    // Wait for agent to connect via ParticipantConnected event.
    // Don't transition here — onAgentConnected() will handle it
  } else {
    _transitionTo(AgentPresenceState.agentAbsent);  // ← falls back silently
  }
}
```
If the dispatch fails (network error because WebSocket is reconnecting), the state
falls back to `agentAbsent` with no retry. The user's unmute + dispatch intent is lost.

---

## Fix Plan

### Fix 1 (HIGH PRIORITY — breaks the ICE loop): Suppress `_refreshAudioTrack` post-reconnect when no agent is present

**File:** `apps/mobile/lib/services/livekit_service.dart`

**Problem:** `_refreshAudioTrack()` is called unconditionally from `RoomReconnectedEvent`,
but the BT routing restoration it targets is only needed when the agent is actively
present (tracks being subscribed). When the room reconnects after agent idle departure, no
remote audio tracks exist, so `restartTrack()` has no routing benefit — but still triggers
the ICE loop.

**Fix:** Guard `_refreshAudioTrack()` in the `RoomReconnectedEvent` handler so it only
runs when an agent is present in the room. When no agent is present, defer the track
refresh to the next `ParticipantConnectedEvent` (agent joins), which already calls no
explicit audio refresh (track subscription handles routing on join).

**Before (`livekit_service.dart:528-532`):**
```dart
// After reconnection, refresh audio track to restore BT routing.
// Network transitions (WiFi→cellular) tear down the old audio session,
// causing Android to fall back to speaker. restartTrack() re-establishes
// the correct audio route (BT SCO if headset is connected). (BUG-021)
_refreshAudioTrack();
```

**After:**
```dart
// After reconnection, refresh audio track to restore BT routing, but
// only when an agent is present. If the room is empty (post-idle), skip
// the refresh — restartTrack() would trigger a device-change event that
// starts another ICE renegotiation cycle (BUG-010).
final agentPresent = _room!.remoteParticipants.values
    .any((p) => p.kind == ParticipantKind.AGENT);
if (agentPresent) {
  _refreshAudioTrack();
}
```

**Edge cases:**
- If BT routing breaks during a solo-participant reconnect (no agent), it won't be
  restored until the next agent joins. Acceptable — the agent joins immediately after
  dispatch, triggering a new `ParticipantConnectedEvent`. The existing audio track will
  be captured on the next `setMicrophoneEnabled(true)` call.
- If the agent is mid-join when `RoomReconnectedEvent` fires (present in room but track
  not yet subscribed), `agentPresent` will be true and the refresh will still run. The
  loop guard (Fix 2 below) prevents cascading.

---

### Fix 2 (HIGH PRIORITY — prevents loop even if Fix 1 is bypassed): Break the
`devicechange → refreshAudioTrack → devicechange` loop

**File:** `apps/mobile/lib/services/livekit_service.dart`

**Problem:** `_onDeviceChange` checks `_reconnecting` as a guard, but `_reconnecting` is
cleared to `false` before `_refreshAudioTrack()` is called. Once the refresh itself fires
a new `devicechange`, the guard passes and the loop continues.

**Fix:** Set `_reconnecting = true` (or introduce a dedicated `_isTrackRefreshing` flag
separate from `_isRefreshingAudio`) for the duration of the `_refreshAudioTrack` call,
so that any `devicechange` events fired during the restart are suppressed.

Alternatively (simpler): add a post-restart debounce suppression window by cancelling
the device change subscription for 5 seconds after a track restart completes.

**Before (`livekit_service.dart:1014-1038`):**
```dart
Future<void> _refreshAudioTrack() async {
  if (_isRefreshingAudio || _localParticipant == null) return;
  _isRefreshingAudio = true;
  debugPrint('[Fletcher] Audio device changed — refreshing audio track');
  try {
    await Future.delayed(const Duration(seconds: 1));
    final publication = _localParticipant!.audioTrackPublications.firstOrNull;
    final track = publication?.track;
    if (track != null && !_isMuted) {
      await track.restartTrack();
      debugPrint('[Fletcher] Audio track restarted successfully');
    }
  } catch (e) {
    debugPrint('[Fletcher] Audio track refresh failed: $e');
  } finally {
    _isRefreshingAudio = false;
  }
}
```

**After (add suppression window):**
```dart
Future<void> _refreshAudioTrack() async {
  if (_isRefreshingAudio || _localParticipant == null) return;
  _isRefreshingAudio = true;
  debugPrint('[Fletcher] Audio device changed — refreshing audio track');
  try {
    await Future.delayed(const Duration(seconds: 1));
    final publication = _localParticipant!.audioTrackPublications.firstOrNull;
    final track = publication?.track;
    if (track != null && !_isMuted) {
      await track.restartTrack();
      debugPrint('[Fletcher] Audio track restarted successfully');
    }
  } catch (e) {
    debugPrint('[Fletcher] Audio track refresh failed: $e');
  } finally {
    _isRefreshingAudio = false;
    // Suppress device-change events for 5s after restartTrack() completes —
    // getUserMedia() internally fires devicechange on Android, which would
    // loop back into another restartTrack() call (BUG-010).
    _deviceChangeDebounce?.cancel();
    _deviceChangeDebounce = Timer(const Duration(seconds: 5), () {
      // No-op: just exhausts the debounce window so _onDeviceChange
      // cannot fire a new refresh for 5 seconds.
    });
  }
}
```

**Edge cases:**
- A genuine BT device swap that occurs within 5s of a track restart will be suppressed.
  This is acceptable: the user is unlikely to swap BT devices immediately after a network
  transition, and the existing 2s debounce was already imperfect for rapid swaps.
- `_deviceChangeDebounce` is already used in `_onDeviceChange` — reusing it here means
  a natural device swap that happens during the suppression window simply gets deferred
  to 5s post-restart rather than dropped.

---

### Fix 3 (MEDIUM PRIORITY — prevents stuck UI): Clear `reconnecting` state in
`_updateAudioLevels` when room is connected and no reconnect is in progress

**File:** `apps/mobile/lib/services/livekit_service.dart`

**Problem:** `_updateAudioLevels()` has a sticky `Keep error/reconnecting state` branch
(lines 1123-1125) that holds the `reconnecting` status even after the SDK has recovered.
If `RoomReconnectedEvent` fires and then the 100ms timer loop runs before `_updateState`
is notified, or if a subsequent `TrackUnsubscribedEvent` re-sets `reconnecting`, the state
can become permanently stuck.

**Before (`livekit_service.dart:1121-1125`):**
```dart
if (_isMuted) {
  newStatus = ConversationStatus.muted;
} else if (_state.status == ConversationStatus.error ||
    _state.status == ConversationStatus.reconnecting) {
  // Keep error/reconnecting state
```

**After:**
```dart
if (_isMuted) {
  newStatus = ConversationStatus.muted;
} else if (_state.status == ConversationStatus.error) {
  // Keep error state (requires explicit user action to clear)
} else if (_state.status == ConversationStatus.reconnecting && _reconnecting) {
  // Keep reconnecting state only while a reconnect is actually in progress.
  // If _reconnecting was cleared by RoomReconnectedEvent but the status
  // wasn't yet updated (race), let the normal audio-level logic take over. (BUG-010)
```

**Edge cases:**
- The `_reconnecting` flag must be set/cleared consistently with the reconnecting status.
  Verify that every path that sets `_updateState(status: reconnecting)` also sets
  `_reconnecting = true`. Currently: `RoomReconnectingEvent` (line 456) does not set
  `_reconnecting = true` — it only calls `_reconnectScheduler.begin()`. The
  `_reconnecting` flag is only set by `_reconnectRoom()` (line 1499). The SDK-native
  reconnect (via `RoomReconnectingEvent`) does NOT go through `_reconnectRoom()`, so
  `_reconnecting` stays `false` during SDK-native reconnects.

This means Fix 3 as written above would incorrectly allow `reconnecting` to clear during
a genuine SDK-native reconnect. The fix must also set `_reconnecting = true` in the
`RoomReconnectingEvent` handler:

**Additional change in `RoomReconnectingEvent` handler (`livekit_service.dart:450-471`):**
```dart
_listener?.on<RoomReconnectingEvent>((_) {
  debugPrint('[Fletcher] SDK reconnecting...');
  _reconnecting = true;                   // ← add this line (BUG-010)
  _reconnectScheduler.begin();
  _updateState(status: ConversationStatus.reconnecting);
  ...
```

This aligns `_reconnecting` with the `reconnecting` status for all paths.

---

### Fix 4 (MEDIUM PRIORITY — dispatch guard): Block agent dispatch when room is reconnecting

**File:** `apps/mobile/lib/services/livekit_service.dart`

**Problem:** `toggleMute()` fires agent dispatch regardless of the room's connection state.
If the ICE layer is mid-reconnect when the user unmutes, the dispatch call either fails
silently or succeeds but the joining agent can't establish tracks.

**Before (`livekit_service.dart:1203-1207`):**
```dart
if (agentPresenceService.enabled &&
    agentPresenceService.state == AgentPresenceState.agentAbsent) {
  debugPrint('[Fletcher] Unmute while agent absent — triggering dispatch');
  agentPresenceService.onSpeechDetected();
}
```

**After:**
```dart
if (agentPresenceService.enabled &&
    agentPresenceService.state == AgentPresenceState.agentAbsent &&
    !_reconnecting &&
    _state.status != ConversationStatus.reconnecting) {
  debugPrint('[Fletcher] Unmute while agent absent — triggering dispatch');
  agentPresenceService.onSpeechDetected();
} else if (agentPresenceService.enabled &&
    agentPresenceService.state == AgentPresenceState.agentAbsent &&
    (_reconnecting || _state.status == ConversationStatus.reconnecting)) {
  debugPrint('[Fletcher] Unmute while agent absent — deferring dispatch until reconnected (BUG-010)');
  // Dispatch will be re-triggered by the audio-level speech detection
  // in _updateAudioLevels() once the room is stable.
}
```

**Edge cases:**
- The audio-level speech detection loop in `_updateAudioLevels()` (lines 1093-1106)
  checks `agentPresenceService.state == AgentPresenceState.agentAbsent && !_isMuted` —
  this will naturally trigger dispatch once the room reconnects and audio levels are
  flowing. No additional "re-trigger on reconnect" logic is needed.
- If the user unmutes, speaks, and the room reconnects quickly, the speech frames may
  not accumulate before dispatch fires. The 300ms (3 frames × 100ms) detection window
  is short enough that this is not a practical concern.

---

### Fix 5 (LOW PRIORITY — duplicate log): Deduplicate `SDK reconnect attempt 1/10` log

**File:** `apps/mobile/lib/services/livekit_service.dart`

**Problem:** The `RoomAttemptReconnectEvent` handler fires twice for attempt=1 due to
the SDK-side race (Symptom 2). This is a LiveKit SDK bug and can't be fully prevented
at the app layer without SDK changes. However, the log can be deduplicated.

**Before (`livekit_service.dart:473-484`):**
```dart
_listener?.on<RoomAttemptReconnectEvent>((event) {
  _reconnectScheduler.begin();
  debugPrint(
    '[Fletcher] SDK reconnect attempt ${event.attempt}/${event.maxAttemptsRetry} '
    '(next retry in ${event.nextRetryDelaysInMs}ms)',
  );
});
```

**After:**
```dart
int _lastLoggedReconnectAttempt = 0;                     // add field at class level
...
_listener?.on<RoomAttemptReconnectEvent>((event) {
  _reconnectScheduler.begin();
  // Deduplicate: SDK may emit attempt=1 twice when both peer connections
  // fail simultaneously (BUG-010). Only log each attempt number once.
  if (event.attempt != _lastLoggedReconnectAttempt) {
    _lastLoggedReconnectAttempt = event.attempt;
    debugPrint(
      '[Fletcher] SDK reconnect attempt ${event.attempt}/${event.maxAttemptsRetry} '
      '(next retry in ${event.nextRetryDelaysInMs}ms)',
    );
  }
});
```

Reset `_lastLoggedReconnectAttempt = 0` in `RoomReconnectedEvent` and
`RoomDisconnectedEvent` handlers.

---

## Fix Priority Order

| Priority | Fix | Symptom Addressed |
|----------|-----|-------------------|
| 1 | Fix 1 — guard `_refreshAudioTrack` on agent presence | Breaks the 25s ICE loop (S1) |
| 2 | Fix 2 — post-restart suppression window in `_refreshAudioTrack` | Belt-and-suspenders for S1 |
| 3 | Fix 3 — clear `reconnecting` state when `_reconnecting=false` | UI stuck in Reconnecting (S3) |
| 3 | Fix 3a — set `_reconnecting=true` in `RoomReconnectingEvent` | Required for Fix 3 to be safe |
| 4 | Fix 4 — dispatch guard on `_reconnecting` in `toggleMute` | Dispatch during ICE reconnect (S4) |
| 5 | Fix 5 — deduplicate reconnect attempt log | Duplicate log (S2, cosmetic) |

Fixes 1 + 2 together eliminate the ICE loop (Symptom 1) and the stuck UI (Symptom 3,
because the loop itself is what keeps re-entering `reconnecting`). Fixes 3 + 3a add an
independent safety net for the UI state machine. Fix 4 prevents wasted dispatch calls.
Fix 5 is cosmetic cleanup.

---

## Acceptance Criteria

- [x] After agent idle disconnect, no repeated ICE drop/reconnect cycles
- [x] Only one set of `SDK reconnect attempt N/10` events per disconnect event
- [x] UI clears "Reconnecting…" banner within 2s of `SDK reconnected successfully`
- [x] Agent dispatch re-fires correctly after coincident ICE reconnect + agent departure

---

## Files Changed (when implemented)

- `apps/mobile/lib/services/livekit_service.dart`:
  - `RoomReconnectedEvent` handler: guard `_refreshAudioTrack()` on agent presence
  - `_refreshAudioTrack()`: add 5s post-restart suppression window
  - `_updateAudioLevels()`: change sticky `reconnecting` guard to check `_reconnecting`
  - `RoomReconnectingEvent` handler: set `_reconnecting = true`
  - `toggleMute()`: add reconnect state guard before dispatch
  - `RoomAttemptReconnectEvent` handler: deduplicate log
  - Add `_lastLoggedReconnectAttempt` field (Fix 5)

---

## Related

- BUG-010: `docs/field-tests/20260310-buglog.md`
- `apps/mobile/lib/services/livekit_service.dart` — reconnect handler
- `~/.pub-cache/hosted/pub.dev/livekit_client-2.5.4/lib/src/core/engine.dart:932` —
  `handleReconnect` (SDK bug: no concurrent-call guard before `emit`)
- `~/.pub-cache/hosted/pub.dev/livekit_client-2.5.4/lib/src/track/local/local.dart:197` —
  `restartTrack()` (calls `getUserMedia()` which fires `devicechange` on Android)
- `tasks/09-connectivity/` — related connectivity tasks

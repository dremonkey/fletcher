# TASK-025: UI State Desync — Agent Connection Status

## Status
- **Status:** Open
- **Priority:** Medium
- **Depends on:** None
- **Owner:** Unassigned
- **Created:** 2026-03-07

## Bug Reference
- **BUG-010** in [`docs/field-tests/20260307-buglog.md`](../../docs/field-tests/20260307-buglog.md)
- **Screenshot:** [`docs/field-tests/20260307-diagnostics-panel.png`](../../docs/field-tests/20260307-diagnostics-panel.png)

## Problem

The Flutter UI (Brutalist Redesign) shows the agent as "not connected" (`AGENT: --` and `SESSION: --` in diagnostics panel) even when a voice session is actively running with full STT/TTS/LLM interaction.

**Observed symptoms:**
- User can speak and receive agent responses
- Transcripts are flowing correctly
- Audio waveforms are active
- But diagnostics panel shows:
  - `AGENT: --` (should show agent identity, e.g., `worker-abc123`)
  - `SESSION: --` (should show room name, e.g., `fletcher-1234567890`)

**User impact:** Confusing UI state creates uncertainty about connection health despite functional voice interaction.

## Root Cause Analysis

The issue stems from **timing races and incomplete diagnostics updates** in the LiveKit connection lifecycle:

### 1. Initial Connection Race Condition
**Location:** `LiveKitService.connect()` (lines 349-361)

When the client first connects to the room:
```dart
// Check if agent is already in the room
final hasAgent = _room!.remoteParticipants.isNotEmpty;
// ...
final agentId = hasAgent
    ? _room!.remoteParticipants.values.first.identity
    : null;
_updateState(
  diagnostics: _state.diagnostics.copyWith(
    connectedAt: DateTime.now(),
    sessionName: _currentRoomName,
    agentIdentity: agentId,  // ← NULL if agent hasn't joined yet
  ),
);
```

**Problem:** The agent worker typically joins the room **after** the client, creating a race:
1. Client connects → `remoteParticipants` is empty
2. Diagnostics initialized with `agentIdentity: null`, `sessionName: <roomName>`
3. Agent joins 100-500ms later → `ParticipantConnectedEvent` fires
4. Event handler **does** update `agentIdentity` (line 511) ✅
5. BUT: The `sessionName` may not persist if there were intermediate state updates

**Why `SESSION` shows `--`:**
- `_currentRoomName` is set correctly during `connectWithDynamicRoom()`
- Initial diagnostics set `sessionName: _currentRoomName`
- BUT: If any intermediate `_updateState()` call doesn't explicitly include `diagnostics` parameter, it might revert to the default `const DiagnosticsInfo()` (which has `sessionName: null`)

### 2. State Update Propagation Issue
**Location:** `LiveKitService._updateState()` (line 1078)

The `_updateState()` helper method signature:
```dart
void _updateState({
  ConversationStatus? status,
  // ... other parameters ...
  DiagnosticsInfo? diagnostics,
}) {
  _state = _state.copyWith(
    status: status,
    // ...
    diagnostics: diagnostics,  // ← Only updates if explicitly passed
  );
  notifyListeners();
}
```

**Problem:** Many `_updateState()` calls throughout the codebase don't pass the `diagnostics` parameter. While `copyWith` preserves existing values when a parameter is null, there's a risk that diagnostics are silently dropped if not explicitly preserved during state transitions (e.g., reconnection events, status changes).

### 3. Reconnection Flow Doesn't Re-Populate Diagnostics
**Location:** `RoomReconnectedEvent` handler (lines 427-445)

When the room reconnects after a network transition:
```dart
_listener?.on<RoomReconnectedEvent>((_) async {
  // ...
  _updateState(
    status: _isMuted ? ConversationStatus.muted : ConversationStatus.idle,
  );
  // No diagnostics re-population here! ❌
});
```

**Problem:** After reconnection, the diagnostics info (session name, agent identity, connected timestamp) is **not re-verified or refreshed**. If the agent rejoined under a different identity or the diagnostics were lost during the disconnect, they won't be restored.

### 4. Participant Disconnection Clears Agent Identity But Not Session
**Location:** `ParticipantDisconnectedEvent` handler (lines 529-548)

```dart
_listener?.on<ParticipantDisconnectedEvent>((event) {
  final remaining = _room?.remoteParticipants.length ?? 0;
  // ...
  if (remaining == 0) {
    _updateState(
      diagnostics: _state.diagnostics.copyWith(clearAgentIdentity: true),
      // ↑ Clears agentIdentity but leaves sessionName, connectedAt intact
    );
  }
});
```

**Observation:** This is correct behavior — session persists even if the agent temporarily disconnects. However, if the agent reconnects, the `ParticipantConnectedEvent` must restore `agentIdentity`, which it does (line 511). So this part is working as intended.

## Proposed Fix

### Phase 1: Ensure Diagnostics Persist Across State Updates (Low-Risk)
**Goal:** Prevent diagnostics from being silently dropped during state transitions.

**Changes:**
1. **Audit all `_updateState()` calls** in `LiveKitService`:
   - Identify calls that modify `status`, `transcript`, or other state without passing `diagnostics`
   - Verify that `copyWith` semantics correctly preserve diagnostics when the parameter is `null`
   - Add explicit `diagnostics: _state.diagnostics` to state updates during critical paths (connection, reconnection, participant events) if needed for clarity

2. **Add defensive logging**:
   - In `_updateState()`, add a debug assertion or log when diagnostics fields become null unexpectedly:
     ```dart
     if (diagnostics?.sessionName == null && _state.diagnostics.sessionName != null) {
       debugPrint('[Fletcher] WARNING: sessionName cleared during state update');
     }
     ```

### Phase 2: Refresh Diagnostics on Reconnection (Medium-Risk)
**Goal:** Re-verify agent presence and session info after successful reconnection.

**Changes:**
1. **In `RoomReconnectedEvent` handler** (line 427):
   - After reconnection succeeds, enumerate current participants
   - Update diagnostics with current agent identity (if agent is present)
   - Preserve `sessionName` and `connectedAt` from previous state
   ```dart
   _listener?.on<RoomReconnectedEvent>((_) async {
     // ... existing reconnect logic ...
     
     // Re-verify agent presence after reconnection
     final hasAgent = _room!.remoteParticipants.isNotEmpty;
     final agentId = hasAgent
         ? _room!.remoteParticipants.values.first.identity
         : null;
     
     _updateState(
       status: _isMuted ? ConversationStatus.muted : ConversationStatus.idle,
       diagnostics: _state.diagnostics.copyWith(
         agentIdentity: agentId,
         // Preserve sessionName and connectedAt
       ),
     );
   });
   ```

### Phase 3: Add Participant Enumeration Logging (Debugging Aid)
**Goal:** Provide visibility into participant state during initial connection and reconnection.

**Changes:**
1. **Enhanced logging in `connect()`** (after line 351):
   ```dart
   debugPrint('[Fletcher] Room joined: participants=${_room!.remoteParticipants.length}');
   for (var p in _room!.remoteParticipants.values) {
     debugPrint('[Fletcher]   → ${p.identity} (kind=${p.kind})');
   }
   ```

2. **Enhanced logging in `ParticipantConnectedEvent`** (line 506):
   ```dart
   debugPrint('[Fletcher] Participant connected: ${event.participant.identity} '
       '(total=${_room?.remoteParticipants.length ?? 0})');
   ```

### Phase 4: Add E2E Test for Diagnostics State (Verification)
**Goal:** Prevent regression by asserting diagnostics are populated during normal and reconnection flows.

**Test scenarios:**
1. **Initial connection:** Assert `diagnostics.sessionName` and `diagnostics.agentIdentity` are non-null within 2 seconds of connection
2. **Agent late-join:** Connect to room, wait for agent to join, assert `diagnostics.agentIdentity` updates
3. **Reconnection:** Trigger network disconnect, wait for reconnection, assert diagnostics are still populated
4. **Agent disconnect/reconnect:** Agent leaves room, rejoins, assert `diagnostics.agentIdentity` updates correctly

**Test file:** `apps/mobile/integration_test/diagnostics_state_test.dart`

## Acceptance Criteria
- [ ] Diagnostics panel shows correct `SESSION` (room name) immediately after connection
- [ ] Diagnostics panel shows correct `AGENT` identity within 2 seconds of agent joining the room
- [ ] Diagnostics persist correctly across state transitions (mute/unmute, status changes)
- [ ] Diagnostics refresh correctly after `RoomReconnectedEvent`
- [ ] Enhanced logging shows participant enumeration during connection and reconnection
- [ ] E2E test validates diagnostics state in normal and edge-case flows
- [ ] No regression: existing functionality (transcripts, artifacts, audio) remains unaffected

## Implementation Notes

### Key Files to Modify
1. **`apps/mobile/lib/services/livekit_service.dart`**
   - Audit and enhance state update calls (Phase 1)
   - Add diagnostics refresh in `RoomReconnectedEvent` handler (Phase 2)
   - Add participant enumeration logging (Phase 3)

2. **`apps/mobile/integration_test/diagnostics_state_test.dart`** (new file)
   - E2E test for diagnostics state persistence (Phase 4)

### Testing Strategy
1. **Manual verification:**
   - Run Flutter app on physical device
   - Observe diagnostics panel during initial connection (should show session and agent)
   - Trigger network disconnect (airplane mode toggle), observe diagnostics after reconnection
   - Verify no `--` values appear when agent is actively connected

2. **Integration test:**
   - Use `integration_test` package with mock LiveKit room
   - Simulate connection, agent join, disconnection, reconnection
   - Assert diagnostics state at each stage

3. **Log analysis:**
   - Review debug logs for participant enumeration
   - Verify no warnings about diagnostics being unexpectedly cleared

### Risk Assessment
- **Low risk:** Phase 1 (audit and defensive logging) — read-only changes, no behavior modification
- **Medium risk:** Phase 2 (reconnection diagnostics refresh) — modifies reconnection flow, potential for unintended side effects
- **Low risk:** Phase 3 (logging) — debugging aid only, no functional impact
- **Low risk:** Phase 4 (E2E test) — test infrastructure, doesn't affect production code

### Rollback Plan
If Phase 2 causes issues:
1. Revert the `RoomReconnectedEvent` handler changes
2. Keep Phase 1 (audit/logging) and Phase 3 (enhanced logs) for further debugging
3. Investigate why diagnostics aren't persisting across reconnects before retrying Phase 2

## Technical Debt Notes
- **State management complexity:** The `LiveKitService` mixes connection lifecycle, audio handling, transcription, and UI state updates. Consider refactoring into separate services (e.g., `ConnectionService`, `DiagnosticsService`, `TranscriptionService`) to reduce cognitive load and improve testability.
- **Participant enumeration pattern:** The current pattern of checking `remoteParticipants.isNotEmpty` and picking `.first.identity` is fragile. Consider tracking agent participants explicitly by `ParticipantKind.AGENT` filter or by identity prefix (e.g., `worker-*`).

## References
- [BUG-010: UI State Desync](../../docs/field-tests/20260307-buglog.md)
- [LiveKit SDK RoomEvent documentation](https://docs.livekit.io/client-sdk-flutter/room-events/)
- [TASK-024: Diagnostics Live Pipeline Values](./024-diagnostics-live-pipeline-values.md) (related UI work)

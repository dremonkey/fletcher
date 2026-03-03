# Task: Diagnostics shows "no agent" after successful network reconnect

## Problem

After a network transition that triggers a DUPLICATE_IDENTITY eviction (e.g., WiFi→5G→WiFi), the Flutter diagnostics panel shows no agent present, even though the agent IS responding and the session is working. The UI is misleading.

**Field test reference:** [BUG-016](../../docs/field-tests/20260302-buglog.md)

## Root Cause

The `HealthService` in the Flutter app caches participant state and doesn't re-enumerate room participants after a reconnect. It likely only checks for agent presence on initial join. When the client reconnects via DUPLICATE_IDENTITY (old participant evicted, new one joins), the `HealthService` doesn't re-query the room and shows stale state.

## Fix

After a reconnect event (either ICE reconnect or DUPLICATE_IDENTITY-style rejoin), the Flutter client should:

1. Re-enumerate room participants
2. Check for agent presence (participant with `kind: "agent"`)
3. Update the diagnostics panel accordingly

### Where to hook in

- `LiveKitService` likely has a `onReconnected` callback or similar
- `HealthService` needs a `refreshParticipants()` method
- May also need to handle the `Room.onParticipantConnected` event more robustly

## Acceptance Criteria

- [ ] After WiFi→5G→WiFi reconnect, diagnostics correctly shows agent present
- [ ] After ICE reconnect (no DUPLICATE_IDENTITY), diagnostics remains accurate
- [ ] After joining a room where agent is already present, diagnostics shows green immediately

## Files

- `apps/mobile/lib/services/health_service.dart` — diagnostics state management
- `apps/mobile/lib/services/livekit_service.dart` — reconnection event handling

## Priority

**Medium** — Cosmetic/misleading UI. The agent works fine; the diagnostics just don't reflect it.

## Status
- **Date:** 2026-03-02
- **Priority:** Medium
- **Status:** Not started

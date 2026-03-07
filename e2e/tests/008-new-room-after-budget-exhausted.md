# New Room After Reconnect Budget Exhausted

Verify that when the app loses network connectivity for longer than the ReconnectScheduler's 130-second budget, it automatically generates a new dynamic room name, fetches a fresh token from the token endpoint, and reconnects with a freshly dispatched agent — without showing a permanent error state to the user.

This test exercises the fix for BUG-005 (agent not dispatched after worker restart) implemented in Task 021 (dynamic room names). The key invariant: the app must NEVER strand the user in an error state after a long outage. It should silently recover by minting a new room.

## Preconditions

- Emulator is running (`adb devices` shows the device)
- Fletcher APK is installed (`adb shell pm list packages | grep com.fletcher.fletcher`)
- The token server is reachable on port 7882 from the emulator host (`curl http://localhost:7882/token?room=test&identity=user1` returns a JWT)
- The LiveKit server and voice-agent container are both running
- Airplane mode is currently OFF before the test begins

## Steps

### Step 1: Force-stop the app, grant permissions, and clear logcat

Force-stop the app, pre-grant runtime permissions so no dialogs block the test, and clear the logcat buffer before launching so log captures in later steps aren't polluted by logs from a previous run.

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell am force-stop com.fletcher.fletcher
```

```sh
e2e/helpers/grant-permissions.sh
```

```sh
adb -s ${DEVICE_ID:-emulator-5554} logcat -c
```

Wait 2 seconds.

### Step 2: Launch the app

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell am start -n com.fletcher.fletcher/.MainActivity
```

Wait 2 seconds, then capture.

```sh
e2e/helpers/emu-capture.sh 008-step2-launch
```

**Expect:**
- Dark background with compact waveform at top
- Diagnostics bar below waveform (showing initial connection state)
- Chat area in center with system event cards beginning to appear
- 56dp square mic button at bottom in connecting state (disabled/grayed appearance)

### Step 3: Wait for idle state

Wait up to 30 seconds for the app to fully connect and reach the idle listening state. Poll with captures every 3 seconds.

```sh
e2e/helpers/emu-capture.sh 008-step3-idle
```

**Expect:**
- Diagnostics bar shows `SYS: OK` with green health orb
- Compact waveform at top is stable
- Chat area displays system event cards showing successful boot and connection
- 56dp square mic button at bottom with breathing glow (active/ready state)
- No error indicators in diagnostics bar or chat

### Step 4: Record the initial room name from logcat

Scrape logcat to find the room name that was assigned at connect time. The app logs a line of the form `[Fletcher] Room: fletcher-NNNN` when it joins a room.

```sh
adb -s ${DEVICE_ID:-emulator-5554} logcat -d | grep -E '\[Fletcher\] Room:' | tail -1
```

Note the full room name (e.g., `fletcher-1741276800000`). This is the INITIAL room. The test will later verify the app connects to a DIFFERENT room name after budget exhaustion.

```sh
e2e/helpers/emu-capture.sh 008-step4-initial-room
```

**Expect:**
- The logcat output contains exactly one line matching `[Fletcher] Room: fletcher-NNNN` where NNNN is a Unix millisecond timestamp
- The log screenshot confirms the app is in the "Listening" state, confirming a full successful connect

### Step 5: Enable airplane mode to simulate extended network outage

Cutting all connectivity forces the ReconnectScheduler to begin its time-budgeted retry loop. The budget is 130 seconds (departure_timeout 120s + 10s margin). We will hold airplane mode on for longer than that.

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell cmd connectivity airplane-mode enable
```

Wait 15 seconds, then capture.

```sh
e2e/helpers/emu-capture.sh 008-step5-airplane-on
```

**Expect:**
- Diagnostics bar shows `SYS: RECONNECTING` or `SYS: ERROR` (not `SYS: OK`)
- Health orb in diagnostics bar is red or amber (indicating network issue)
- Chat area shows system event card indicating network loss/disconnection
- Compact waveform may be static or frozen
- 56dp mic button is disabled (grayed appearance)
- The airplane mode icon is visible in the Android status bar at the top of the screen
- No permanent error message or error state is shown (the app is still trying)

### Step 6: Continue waiting well past the 130-second budget

Keep airplane mode ON for a total of 140 seconds from when it was enabled (Step 5 already consumed 15 seconds, so wait 125 more seconds here). The ReconnectScheduler's slow-poll phase continues attempting reconnects every 10 seconds, each one failing because there is no network. The budget clock is ticking.

Wait 125 seconds.

```sh
e2e/helpers/emu-capture.sh 008-step6-budget-elapsed
```

**Expect:**
- Diagnostics bar still shows `SYS: RECONNECTING` or `SYS: ERROR` — the app is still retrying, NOT in a hard error state
- Health orb remains red or amber
- Chat area continues to show network loss system event cards
- The airplane mode icon remains visible in the status bar
- No dialog, toast, or persistent error banner saying "Session expired" or "Failed to reconnect" — the app is designed to recover silently via a new room

### Step 7: Disable airplane mode to restore network

Now that the 130-second budget has elapsed, restoring the network should cause the app to detect connectivity, check the elapsed time against the budget, realize the budget is exhausted, and trigger the new-room recovery path rather than attempting to rejoin the stale room.

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell cmd connectivity airplane-mode disable
```

Wait 5 seconds, then capture the moment just after network restore.

```sh
e2e/helpers/emu-capture.sh 008-step7-network-restored
```

**Expect:**
- The airplane mode icon has disappeared from the Android status bar
- Diagnostics bar transitions out of `SYS: ERROR` state — the app detected connectivity
- The app is actively working (diagnostics bar shows `SYS: RECONNECTING` or transitioning to `SYS: OK`) — NOT stuck in error state
- Chat area shows system event card indicating recovery progress (e.g., "Reconnecting...", "Generating new room...")

### Step 8: Wait for full recovery with new room

The app now needs to: detect that the budget is exhausted, generate a new room name (`fletcher-<new-timestamp>`), call the token endpoint (port 7882) for a fresh JWT, connect to LiveKit with the new room name, and wait for a fresh agent to be dispatched. Allow up to 45 seconds for this multi-step recovery.

Wait up to 45 seconds. Poll with captures every 5 seconds.

```sh
e2e/helpers/emu-capture.sh 008-step8-recovery
```

**Expect:**
- Diagnostics bar shows `SYS: OK` — full recovery achieved
- Health orb in diagnostics bar is green
- Compact waveform is actively moving/breathing (indicating active connection)
- Chat area displays system event cards showing new room connection and fresh agent dispatch
- 56dp square mic button at bottom has breathing glow (active/ready)
- No error indicators visible anywhere on screen

### Step 9: Verify recovery logs — budget exhaustion and new room creation

Inspect logcat to confirm the exact recovery sequence: budget exhausted → new room created → token fetched → connected.

```sh
adb -s ${DEVICE_ID:-emulator-5554} logcat -d | grep -E '\[Fletcher\]|\[TokenService\]' | tail -40
```

```sh
e2e/helpers/emu-capture.sh 008-step9-log-verify
```

**Expect the following log lines to appear in order:**

1. `[Fletcher] Reconnect budget exhausted` — confirms the scheduler detected that 130s had elapsed since the first disconnect, and is switching to new-room recovery instead of a regular reconnect

2. `[Fletcher] creating new room` (may appear on same line as above or immediately after) — confirms the decision to mint a new room rather than show an error

3. `[Fletcher] Creating new room for recovery: fletcher-NNNN` where NNNN is a **different** timestamp than the one recorded in Step 4 — confirms a genuinely new room name was generated (not the stale room)

4. `[TokenService] Fetching token` — confirms the app requested a fresh JWT from the token server on port 7882 for the new room name (the old token, which was scoped to the old room, is NOT reused)

5. Either `[Fletcher] Connected` or a LiveKit SDK connect event — confirms the LiveKit connect call succeeded with the new room credentials

**Must NOT appear:**
- Any log line containing `error` followed by `session expired`, `ConversationStatus.error`, or `Failed to reconnect` as the final outcome (the app may log intermediate errors during the retry loop, but the FINAL state must be connected, not error)

### Step 10: Verify the new room name differs from the initial room name

Cross-check the room name from Step 4 against the room name from Step 9.

```sh
adb -s ${DEVICE_ID:-emulator-5554} logcat -d | grep -E '\[Fletcher\] (Room:|Creating new room for recovery:)' | tail -5
```

```sh
e2e/helpers/emu-capture.sh 008-step10-room-name-diff
```

**Expect:**
- The output shows exactly two distinct room names: the original `fletcher-NNNN` from Step 4 and the recovery `fletcher-MMMM` from Step 9
- The two timestamps (NNNN vs MMMM) are different — the recovery room is a new room, not a reconnect to the stale one
- The recovery room name timestamp is greater than the original (it was generated after the outage)

### Step 11: Verify health panel shows green after recovery

Open the Diagnostics panel to confirm all health checks have recovered and the session is considered healthy.

Tap the diagnostics bar (tappable row showing system status, approximately at x=250, y=300).

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell input tap 250 300
```

Wait 1 second, then capture.

```sh
e2e/helpers/emu-capture.sh 008-step11-health-panel
```

**Expect:**
- The Diagnostics TUI bottom sheet opens with amber top border
- The header shows `┌─ DIAGNOSTICS ─┐` or similar TUI-style formatting
- All key-value health check rows are visible (e.g., "WebSocket: connected", "Agent: healthy", "Room: active")
- All rows show passing values (no red/error indicators)
- The health orb or status indicator within the panel shows green
- The panel can be dismissed by tapping outside or pressing back

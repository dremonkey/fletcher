# Reconnect Same Room (Airplane Mode Blip)

Verify that a brief network interruption (~10 seconds, simulated via airplane mode) causes the app to reconnect to the SAME LiveKit room using the cached token, without creating a new room. The agent should still be present after reconnection.

The ReconnectScheduler has a 130s budget. For temporary disconnects within the server's 120s departure_timeout, the cached token and room name are reused. The SDK handles brief blips internally via its own reconnection path; this test validates the full cycle from interruption through recovery.

## Preconditions
- Emulator is running (`adb devices` shows the device)
- Fletcher APK is installed (`adb shell pm list packages | grep com.fletcher.fletcher`)

## Steps

### Step 1: Force-stop and relaunch the app

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell am force-stop com.fletcher.fletcher
```

Wait 2 seconds.

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell am start -n com.fletcher.fletcher/.MainActivity
```

Wait up to 30 seconds for the app to reach idle state. Poll with captures every 3 seconds.

```sh
e2e/helpers/emu-capture.sh 007-step1-idle
```

**Expect:**
- The status badge shows "Listening" (amber text)
- The orb is fully visible with a breathing animation glow
- No error message is displayed below the orb
- The Diagnostics chip is visible above the mute toggle

### Step 2: Note the current room name from logcat

```sh
adb -s ${DEVICE_ID:-emulator-5554} logcat -d --pid=$(adb -s ${DEVICE_ID:-emulator-5554} shell pidof com.fletcher.fletcher) | grep '\[Fletcher\] Room:' | tail -1
```

**Expect:**
- A log line matching `[Fletcher] Room: fletcher-NNNNNNNNNNNN` is visible (where `NNNN` is a Unix millisecond timestamp)
- Record this room name — it must match after reconnection in Step 9

### Step 3: Capture baseline state before interruption

```sh
e2e/helpers/emu-capture.sh 007-step3-pre-interruption
```

**Expect:**
- The status badge shows "Listening" (amber text)
- The Diagnostics chip dot is green (healthy)
- No error or warning message is visible

### Step 4: Toggle airplane mode ON to simulate network interruption

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell cmd connectivity airplane-mode enable
```

Wait 3 seconds, then capture.

```sh
e2e/helpers/emu-capture.sh 007-step4-airplane-on
```

**Expect:**
- The Diagnostics chip dot turns red or amber (health check detects connectivity loss)
- The status badge may still show "Listening" — the SDK handles brief blips internally without surfacing a state change, which is acceptable
- No crash dialog is visible

### Step 5: Confirm stable state at mid-interruption

Wait 5 seconds (total ~8 seconds into the interruption), then capture.

```sh
e2e/helpers/emu-capture.sh 007-step5-reconnecting
```

**Expect:**
- The Diagnostics chip dot remains red or amber (connectivity still lost)
- The app has NOT navigated away or shown a fatal error screen
- The orb is still visible (app has not crashed)

### Step 6: Toggle airplane mode OFF to restore connectivity

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell cmd connectivity airplane-mode disable
```

Wait 3 seconds, then capture immediately after restoration.

```sh
e2e/helpers/emu-capture.sh 007-step6-airplane-off
```

**Expect:**
- The app is still showing a reconnecting or connecting state (recovery is in progress)
- No permanent error message ("Failed to reconnect" or similar) is displayed — the 130s budget has not expired

### Step 7: Wait for the app to return to idle state

Wait up to 30 seconds for the app to recover. Poll with captures every 3 seconds.

```sh
e2e/helpers/emu-capture.sh 007-step7-recovered
```

**Expect:**
- The status badge shows "Listening" (amber text)
- The orb is fully visible with its breathing glow restored
- The Diagnostics chip is visible above the mute toggle

### Step 8: Verify the Diagnostics chip is healthy after reconnect

Identify the Diagnostics chip coordinates from the screenshot (centered row, ~105px from bottom). Tap it.

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell input tap <X> <Y>
```

Wait 1 second, then capture.

```sh
e2e/helpers/emu-capture.sh 007-step8-health-panel
```

**Expect:**
- The Diagnostics bottom sheet is visible
- The chip's colored dot is green (healthy), not amber or red
- Health check rows show passing indicators — no rows flagged as failed or degraded

Dismiss the health panel (tap the X or outside the sheet).

### Step 9: Verify same-room reconnection via logcat

```sh
adb -s ${DEVICE_ID:-emulator-5554} logcat -d --pid=$(adb -s ${DEVICE_ID:-emulator-5554} shell pidof com.fletcher.fletcher) | grep -E '\[Fletcher\] (Room:|SDK reconnect|Creating new room|Disconnected|Fast reconnect|Connected to room)' | tail -20
```

**Expect:**
- Log lines show `[Fletcher] SDK reconnect attempt` during the outage (SDK detected the disconnection)
- After network restore, `[Fletcher] Disconnected: DisconnectReason.stateMismatch` fires (SDK gave up internal reconnection)
- A log line `[Fletcher] Fast reconnect 1/5` is present (app-level ReconnectScheduler takes over)
- A log line `[Fletcher] Connected to room` appears after the fast reconnect (recovery succeeded)
- Only one `[Fletcher] Room: fletcher-NNNNNNNNNNNN` line exists, matching Step 2 — the same room was reused
- NO log line containing `[Fletcher] Creating new room` is present — the cached token and room were reused, not a new room

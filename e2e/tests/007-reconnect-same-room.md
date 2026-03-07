# Reconnect Same Room (Airplane Mode Blip)

Verify that a brief network interruption (~10 seconds, simulated via airplane mode) causes the app to reconnect to the SAME LiveKit room using the cached token, without creating a new room. The agent should still be present after reconnection.

The ReconnectScheduler has a 130s budget. For temporary disconnects within the server's 120s departure_timeout, the cached token and room name are reused. The SDK handles brief blips internally via its own reconnection path; this test validates the full cycle from interruption through recovery.

## Preconditions
- Emulator is running (`adb devices` shows the device)
- Fletcher APK is installed (`adb shell pm list packages | grep com.fletcher.fletcher`)

## Steps

### Step 1: Force-stop, grant permissions, and relaunch the app

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell am force-stop com.fletcher.fletcher
```

```sh
e2e/helpers/grant-permissions.sh
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
- The diagnostics bar at the top displays `SYS: OK | VAD: 0.00 | RT: --`
- The health orb in the diagnostics bar is green
- The 56dp square mic button at the bottom center is visible with a breathing glow animation
- No error message is displayed
- Chat area shows no system event cards

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
- The diagnostics bar displays `SYS: OK | VAD: 0.00 | RT: --`
- The health orb is green (healthy)
- The mic button is visible with breathing glow
- No error or warning message is visible
- No system event cards in chat

### Step 4: Toggle airplane mode ON to simulate network interruption

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell cmd connectivity airplane-mode enable
```

Wait 3 seconds, then capture.

```sh
e2e/helpers/emu-capture.sh 007-step4-airplane-on
```

**Expect:**
- The health orb in the diagnostics bar turns red or amber (health check detects connectivity loss)
- A system event card may appear in the chat showing `✕ NETWORK disconnected`
- The mic button is still visible
- No crash dialog is visible

### Step 5: Confirm stable state at mid-interruption

Wait 5 seconds (total ~8 seconds into the interruption), then capture.

```sh
e2e/helpers/emu-capture.sh 007-step5-reconnecting
```

**Expect:**
- The health orb remains red or amber (connectivity still lost)
- The app has NOT navigated away or shown a fatal error screen
- The mic button is still visible (app has not crashed)
- The chat may show additional system event cards related to reconnection attempts

### Step 6: Toggle airplane mode OFF to restore connectivity

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell cmd connectivity airplane-mode disable
```

Wait 3 seconds, then capture immediately after restoration.

```sh
e2e/helpers/emu-capture.sh 007-step6-airplane-off
```

**Expect:**
- The app is in a reconnecting state (recovery is in progress)
- A system event card in the chat shows reconnection activity (e.g., `↻ ROOM reconnecting` or similar)
- No permanent error message ("Failed to reconnect" or similar) is displayed — the 130s budget has not expired

### Step 7: Wait for the app to return to idle state

Wait up to 30 seconds for the app to recover. Poll with captures every 3 seconds.

```sh
e2e/helpers/emu-capture.sh 007-step7-recovered
```

**Expect:**
- The diagnostics bar displays `SYS: OK | VAD: 0.00 | RT: --`
- The health orb is green (healthy)
- The mic button is visible with breathing glow restored
- System event cards in the chat show successful recovery (e.g., `✓ ROOM connected` or `✓ AGENT ready`)

### Step 8: Verify the diagnostics modal is healthy after reconnect

Tap the diagnostics bar to open the modal (coordinates approximately x=250, y=300, or tap anywhere on the bar).

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell input tap 250 300
```

Wait 1 second, then capture.

```sh
e2e/helpers/emu-capture.sh 007-step8-health-panel
```

**Expect:**
- A TUI-styled bottom sheet modal appears with an amber top border
- The modal header displays `┌─ DIAGNOSTICS ─┐`
- Key-value rows are visible showing healthy system metrics (e.g., `System: OK`, `Network: Connected`, `Room: connected`)
- No degraded or failed indicators are shown
- Health status appears all green

Dismiss the modal by tapping the scrim (outside the sheet area)..

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

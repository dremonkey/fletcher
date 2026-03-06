# Fresh Room on Launch After Departure Timeout

Verify that when the app is force-stopped and relaunched after the departure_timeout has expired, it generates a new dynamic room name instead of reusing the stale saved one, fetches a fresh JWT from the token endpoint, and connects successfully with an agent dispatched.

## Preconditions
- Emulator is running (`adb devices` shows the device)
- Fletcher APK is installed (`adb shell pm list packages | grep com.fletcher.fletcher`)

## Steps

### Step 1: Clear app data (wipe SharedPreferences and kill app)

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell pm clear com.fletcher.fletcher
```

Wait 2 seconds.

### Step 2: Launch the app

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell am start -n com.fletcher.fletcher/.MainActivity
```

Wait 2 seconds, then capture state.

```sh
e2e/helpers/emu-capture.sh 006-step2-launch
```

**Expect:**
- The app is visible on screen (dark background with amber orb in center)
- A status badge near the top shows "Connecting..." (gray text)
- The orb appears at reduced opacity (connecting state, not yet idle)
- No error message is displayed

### Step 3: Wait for idle state

Wait up to 30 seconds for the app to reach idle. Poll with captures every 3 seconds.

```sh
e2e/helpers/emu-capture.sh 006-step3-idle
```

**Expect:**
- The status badge shows "Listening" (amber text)
- The orb is fully visible with a breathing animation glow
- No error message is displayed below the orb
- The mute toggle button is visible at the bottom center

### Step 4: Verify a new room name was generated in logs

```sh
adb -s ${DEVICE_ID:-emulator-5554} logcat -d -t 200 --pid=$(adb -s ${DEVICE_ID:-emulator-5554} shell pidof com.fletcher.fletcher) | grep -E '\[Fletcher\] Room:'
```

Wait 2 seconds, then capture state.

```sh
e2e/helpers/emu-capture.sh 006-step4-room-log
```

**Expect:**
- The logcat output contains a line matching `[Fletcher] Room: fletcher-` followed by a numeric timestamp
- The line includes the marker `(new)` indicating the room name was freshly generated and not loaded from a saved session
- No line shows a room name being reused from a previous session

### Step 5: Verify token fetch in logs

```sh
adb -s ${DEVICE_ID:-emulator-5554} logcat -d -t 200 --pid=$(adb -s ${DEVICE_ID:-emulator-5554} shell pidof com.fletcher.fletcher) | grep -E '\[TokenService\]'
```

Wait 2 seconds, then capture state.

```sh
e2e/helpers/emu-capture.sh 006-step5-token-log
```

**Expect:**
- The logcat output contains a line matching `[TokenService] Fetching token` for the new room name
- The room name in the token fetch log matches the `fletcher-<timestamp>` room name observed in Step 4
- There is no token error or retry loop visible in the logs

### Step 6: Clear app data again and relaunch to verify a second fresh room

Clear SharedPreferences again (simulating a launch after departure_timeout has expired) and confirm a new room name is generated.

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell pm clear com.fletcher.fletcher
```

Wait 2 seconds.

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell am start -n com.fletcher.fletcher/.MainActivity
```

Wait up to 30 seconds for the app to reach idle state. Poll with captures every 3 seconds.

```sh
e2e/helpers/emu-capture.sh 006-step6-relaunch-idle
```

**Expect:**
- The app reconnects successfully and the status badge shows "Listening" (amber text)
- The orb is fully visible with breathing animation
- No error message is displayed

### Step 7: Verify a second new room name was generated (different from Step 4)

```sh
adb -s ${DEVICE_ID:-emulator-5554} logcat -d -t 200 --pid=$(adb -s ${DEVICE_ID:-emulator-5554} shell pidof com.fletcher.fletcher) | grep -E '\[Fletcher\] Room:'
```

Wait 2 seconds, then capture state.

```sh
e2e/helpers/emu-capture.sh 006-step7-new-room-log
```

**Expect:**
- The logcat output contains a `[Fletcher] Room: fletcher-` line with `(new)` for this second launch
- The timestamp in the room name is strictly greater than the one recorded in Step 4 (it is a different, newer room)
- This confirms each cold start with no saved session generates a unique room name

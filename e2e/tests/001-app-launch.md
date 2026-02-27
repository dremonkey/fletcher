# App Launch

Verify the app starts, transitions through the connecting state, and reaches idle.

## Preconditions
- Emulator is running (`adb devices` shows the device)
- Fletcher APK is installed (`adb shell pm list packages | grep com.fletcher.fletcher`)

## Steps

### Step 1: Force-stop the app

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell am force-stop com.fletcher.fletcher
```

Wait 2 seconds.

### Step 2: Launch the app

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell am start -n com.fletcher.fletcher/.MainActivity
```

Wait 2 seconds, then capture state.

```sh
e2e/helpers/emu-capture.sh 001-step2-launch
```

**Expect:**
- The app is visible on screen (dark background with amber orb in center)
- A status badge near the top shows "Connecting..." (gray text)
- The orb appears at roughly 50% opacity (connecting state)

### Step 3: Wait for idle state

Wait up to 30 seconds for the app to reach idle. Poll with captures every 3 seconds.

```sh
e2e/helpers/emu-capture.sh 001-step3-idle
```

**Expect:**
- The status badge now shows "Listening" (amber text)
- The orb is fully visible with a breathing animation glow
- No error message is displayed below the orb
- The mute toggle button is visible at the bottom center (gray circle with mic icon)
- The "Diagnostics" chip is visible in a centered row above the mute toggle

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
- The app is visible on screen (dark background)
- Compact waveform (48dp) at the top showing initial zero state (dim amber/cyan bars)
- Diagnostics bar below waveform showing `SYS: -- | VAD: 0.00 | RT: --` in cyan monospace
- Chat area below diagnostics bar showing system event cards (e.g., "NETWORK resolving...")
- Mic button at bottom center (56dp square, dimmed amber border) in connecting state

### Step 3: Wait for idle state

Wait up to 30 seconds for the app to reach idle. Poll with captures every 3 seconds.

```sh
e2e/helpers/emu-capture.sh 001-step3-idle
```

**Expect:**
- Compact waveform at top displays dual-color histogram (amber for user, cyan for agent)
- Diagnostics bar shows `SYS: OK | VAD: 0.00 | RT: --` with green health orb (12dp square) next to SYS text
- Chat area displays system event cards showing final states: NETWORK connected, ROOM joined, AGENT ready (all in green)
- Mic button at bottom center (56dp square, bright amber border, mic icon, breathing glow animation) in idle state
- No error messages displayed

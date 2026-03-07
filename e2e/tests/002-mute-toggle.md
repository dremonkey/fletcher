# Mute Toggle

Verify tapping the mute button toggles between muted and unmuted states.

## Preconditions
- Emulator is running (`adb devices` shows the device)
- Fletcher app is in idle state — run test 001 first or verify manually

## Steps

### Step 1: Capture initial unmuted state

```sh
e2e/helpers/emu-capture.sh 002-step1-unmuted
```

**Expect:**
- Diagnostics bar at top shows `SYS: OK | VAD: 0.00 | RT: --`
- Mute button at bottom center is a 56x56dp square with sharp corners, amber border, and mic_rounded icon
- Breathing glow animation visible around the button

### Step 2: Tap the mute button

Capture a screenshot to locate the mute button (bottom center, ~56dp square). On Pixel 9 emulator (1080x2424, 420dpi), the button center is approximately x=540, y=2200.

```sh
e2e/helpers/emu-capture.sh 002-step2-pre-tap
```

Tap the mute button.

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell input tap 540 2200
```

Wait 1 second, then capture.

```sh
e2e/helpers/emu-capture.sh 002-step2-muted
```

**Expect:**
- Mute button shows mic_off_rounded icon with dimmed appearance (0.38 opacity)
- Amber border still visible on the square button
- No breathing glow animation
- Diagnostics bar unchanged

### Step 3: Tap mute button again to unmute

Tap the mute button at the same coordinates.

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell input tap 540 2200
```

Wait 1 second, then capture.

```sh
e2e/helpers/emu-capture.sh 002-step3-unmuted
```

**Expect:**
- Mute button returns to mic_rounded icon with full opacity
- Amber border visible on the square button
- Breathing glow animation returns
- Diagnostics bar unchanged

# Mute Toggle

Verify tapping the mute button toggles between muted and unmuted states.

## Preconditions
- Emulator is running (`adb devices` shows the device)
- Fletcher app is in idle ("Listening") state — run test 001 first or verify manually

## Steps

### Step 1: Capture initial unmuted state

```sh
e2e/helpers/emu-capture.sh 002-step1-unmuted
```

**Expect:**
- Status badge shows "Listening"
- Mute toggle at bottom center shows a mic icon on a gray/dark background
- The orb is at full opacity with breathing animation

### Step 2: Tap the mute button

Capture a screenshot to locate the mute toggle (bottom center, ~48px from bottom of safe area). The mute button is a 48x48 circle centered horizontally.

```sh
e2e/helpers/emu-capture.sh 002-step2-pre-tap
```

Identify the mute button coordinates visually, then tap.

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell input tap <X> <Y>
```

Wait 1 second, then capture.

```sh
e2e/helpers/emu-capture.sh 002-step2-muted
```

**Expect:**
- Status badge now shows "Muted" (gray text)
- Mute toggle shows a mic-off icon on an amber/orange background with an orange border
- The orb is dimmed to roughly 30% opacity

### Step 3: Tap mute button again to unmute

Tap the same coordinates as Step 2.

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell input tap <X> <Y>
```

Wait 1 second, then capture.

```sh
e2e/helpers/emu-capture.sh 002-step3-unmuted
```

**Expect:**
- Status badge returns to "Listening" (amber text)
- Mute toggle returns to mic icon on gray background
- The orb returns to full opacity

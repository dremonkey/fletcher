# Health Panel

Verify the Diagnostics chip opens the health panel and displays check rows.

## Preconditions
- Emulator is running (`adb devices` shows the device)
- Fletcher app is in idle ("Listening") state — run test 001 first or verify manually

## Steps

### Step 1: Capture initial state and locate Diagnostics chip

```sh
e2e/helpers/emu-capture.sh 003-step1-initial
```

**Expect:**
- The "Diagnostics" chip is visible in a centered row above the mute toggle
- The chip has a small colored dot (green = healthy, amber = degraded, red = unhealthy) next to the "Diagnostics" label

### Step 2: Tap the Diagnostics chip

Identify the Diagnostics chip coordinates from the screenshot (centered row, ~105px from bottom). Tap it.

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell input tap <X> <Y>
```

Wait 1 second, then capture.

```sh
e2e/helpers/emu-capture.sh 003-step2-panel-open
```

**Expect:**
- A bottom sheet panel is visible, taking roughly the lower 55% of the screen
- The panel header shows "Diagnostics" as the title
- A close button (X) is visible in the panel header
- One or more health check rows are listed, each with an icon, label, and status indicator
- Check rows show either green checkmarks (passing) or amber/red indicators (issues)

### Step 3: Dismiss the health panel

Tap the close button (X) in the panel header, or tap outside the panel.

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell input tap <X> <Y>
```

Wait 1 second, then capture.

```sh
e2e/helpers/emu-capture.sh 003-step3-dismissed
```

**Expect:**
- The health panel is no longer visible
- The main conversation screen is fully visible again
- The Diagnostics chip is still visible at its original position
- The app remains in its previous state (e.g., "Listening")

# Health Panel

Verify the diagnostics bar opens the health modal and displays system status.

## Preconditions
- Emulator is running (`adb devices` shows the device)
- Fletcher app is in idle ("Listening") state — run test 001 first or verify manually

## Steps

### Step 1: Capture initial state and verify diagnostics bar

```sh
e2e/helpers/emu-capture.sh 003-step1-initial
```

**Expect:**
- The diagnostics bar is visible below the compact waveform
- The bar displays a green health orb (12dp square) followed by cyan monospace text: `SYS: OK | VAD: 0.00 | RT: --`
- The entire bar is tappable (full width)

### Step 2: Tap the diagnostics bar to open modal

Tap the diagnostics bar area. On Pixel 9 emulator (1080x2424, 420dpi), tap approximately x=250, y=300.

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell input tap 250 300
```

Wait 1 second, then capture.

```sh
e2e/helpers/emu-capture.sh 003-step2-panel-open
```

**Expect:**
- A bottom sheet modal is visible with a 2dp amber top border
- Modal background is dark (#1A1A1A)
- TuiHeader at the top displays `┌─ DIAGNOSTICS ─┐` in amber monospace
- Key-value rows are visible in 12sp monospace font with cyan labels and white values
- Rows shown: SYS: OK, CONNECTION: CONNECTED, STT: deepgram, TTS: cartesia, LLM: openclaw, VAD: 0.00, RT: --, SESSION: --, AGENT: --, UPTIME: --
- No close button (X) — modal dismisses via dark scrim or swipe down

### Step 3: Dismiss the modal

Tap outside the bottom sheet on the dark scrim area, approximately x=540, y=400.

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell input tap 540 400
```

Wait 1 second, then capture.

```sh
e2e/helpers/emu-capture.sh 003-step3-dismissed
```

**Expect:**
- The health modal is no longer visible
- The main conversation screen is fully visible again
- The diagnostics bar is still visible at its original position below the waveform
- The app remains in its previous state (e.g., "Listening")

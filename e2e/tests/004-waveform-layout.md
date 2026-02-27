# Waveform & Layout Integrity

Verify the audio waveform widget renders in idle state and that all UI elements are properly spaced without overlaps.

## Preconditions
- Emulator is running (`adb devices` shows the device)
- Fletcher app is in idle ("Listening") state — run test 001 first or verify manually

## Steps

### Step 1: Capture full screen layout in idle state

```sh
e2e/helpers/emu-capture.sh 004-step1-layout
```

**Expect:**
- The orb is visible in the center of the screen
- A waveform area is visible between the orb and the chip row (around `bottom: 220`)
- Two subtle waveform visualizations are side-by-side (user amber on the left, agent gray on the right)
- Even with no audio input, the waveform bars are present at minimal height (~2px)

### Step 2: Verify no transcript UI when idle

```sh
e2e/helpers/emu-capture.sh 004-step2-no-transcript
```

**Expect:**
- No transcript subtitle text is visible between the waveform and chip row (area around `bottom: 150`)
- The chip row does NOT contain a "Transcript" chip — only the "Diagnostics" chip is present
- The "Diagnostics" chip is visible in a centered row above the mute toggle

### Step 3: Verify element spacing and no overlaps

```sh
e2e/helpers/emu-capture.sh 004-step3-spacing
```

**Expect:**
- The orb, waveform area, chip row, and mute toggle are all visually separated with clear gaps
- No elements overlap or clip each other
- The vertical order from top to bottom is: status badge → orb → waveform → chip row → mute toggle
- The mute toggle button is at the bottom center with adequate padding from the chip row above

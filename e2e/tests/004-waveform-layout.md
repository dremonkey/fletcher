# Waveform & Layout Integrity

Verify the compact waveform widget renders at the top of the screen in idle state, that all UI elements follow the brutalist TUI layout, and that vertical spacing is correct without overlaps.

## Preconditions
- Emulator is running (`adb devices` shows the device)
- Fletcher app is in idle ("Listening") state — run test 001 first or verify manually

## Steps

### Step 1: Capture full screen layout in idle state

```sh
e2e/helpers/emu-capture.sh 004-step1-layout
```

**Expect:**
- Compact waveform (48dp height) is visible at the top of the screen, directly below the status bar
- Waveform spans full width with 16dp padding on left and right
- Waveform displays 8-bit histogram style bars with sharp corners (not rounded)
- Bars show dual-color visualization: amber bars on left half (user), cyan bars on right half (agent)
- 8dp center gap separates the two color sections
- Even with no audio input, waveform bars are present at minimal height (~2px)
- Below waveform is the diagnostics bar (4dp gap separating them)

### Step 2: Verify no transcript when idle

```sh
e2e/helpers/emu-capture.sh 004-step2-no-transcript
```

**Expect:**
- Chat area shows "Waiting for conversation..." text or system event cards (no separate transcript subtitle widget)
- No "Diagnostics chip" or separate chip row — diagnostics appear inline in the diagnostics bar row
- Diagnostics bar displays: `[●] SYS: OK | VAD: 0.00 | RT: --` format
- Chat transcript is the main content area between diagnostics bar and mic button

### Step 3: Verify element spacing and no overlaps

```sh
e2e/helpers/emu-capture.sh 004-step3-spacing
```

**Expect:**
- Vertical layout order from top to bottom: CompactWaveform (48dp) → SizedBox (4dp gap) → DiagnosticsBar (48dp) → Expanded ChatTranscript → SizedBox (8dp gap) → MicButton (56dp square)
- All elements are properly separated with no overlaps or clipping
- CompactWaveform sits directly below status bar with full width
- DiagnosticsBar sits directly below waveform with 4dp gap
- Chat area expands to fill available space
- MicButton is centered at bottom with 56dp size and amber border
- 16dp padding on bottom above mic button

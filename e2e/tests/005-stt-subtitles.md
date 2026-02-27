# STT Subtitles

Verify that spoken audio is transcribed and displayed as subtitles in the UI. When the user speaks, the TranscriptSubtitle widget should show the transcription text with a "You" speaker label. The subtitle area sits between the waveform row and the chip row.

## Preconditions
- Emulator is running (`adb devices` shows the device)
- Fletcher APK is installed (`adb shell pm list packages | grep com.fletcher.fletcher`)

## Steps

### Step 1: Force-stop and relaunch the app

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell am force-stop com.fletcher.fletcher
```

Wait 2 seconds.

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell am start -n com.fletcher.fletcher/.MainActivity
```

Wait up to 30 seconds for the app to reach idle state. Poll with captures every 3 seconds.

```sh
e2e/helpers/emu-capture.sh 005-step1-idle
```

**Expect:**
- The status badge shows "Listening" (amber text)
- The orb is visible in the center
- No subtitle text is visible between the waveform row and the chip row

### Step 2: Inject speech audio into the emulator mic

```sh
e2e/helpers/emu-speak.sh stt-hello
```

Wait up to 15 seconds for a transcription subtitle to appear. Poll with captures every 3 seconds.

```sh
e2e/helpers/emu-capture.sh 005-step2-subtitle
```

**Expect:**
- A subtitle overlay is visible between the waveform bars and the Diagnostics chip
- The subtitle shows a speaker label "You" in amber/yellow text
- The subtitle contains transcription text (words related to "hello" or "can you hear me")
- The subtitle has a dark semi-transparent background with rounded corners

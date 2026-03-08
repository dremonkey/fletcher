# STT Subtitles

Verify that spoken audio is transcribed and displayed in the chat transcript area. When the user speaks, the transcription appears as a TuiCard message with a "YOU" speaker label in the ChatTranscript, replacing the legacy subtitle overlay. Transcripts are rendered inline as card messages without a separate subtitle layer.

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
- The diagnostics bar shows `SYS: OK` (no status badge)
- The amber orb is not visible (replaced by chat transcript area)
- The chat area displays "Waiting for conversation..." or system event cards
- A compact waveform is visible at the top
- The mic button is at the bottom

### Step 2: Inject speech audio into the emulator mic

```sh
e2e/helpers/emu-speak.sh stt-hello
```

Wait up to 15 seconds for a transcription message to appear in the chat area. Poll with captures every 3 seconds.

```sh
e2e/helpers/emu-capture.sh 005-step2-subtitle
```

**Expect:**
- A TuiCard message appears in the chat transcript area
- The card has a cyan TuiHeader with `┌─ YOU ─┐` label
- The card displays transcribed text (words related to "hello" or similar)
- Text may initially appear in italic (interim transcription) then become normal (final transcription)
- The card has sharp corners (BorderRadius.zero) and a surface background (#1A1A1A)
- No subtitle overlay — the text is integrated into the main chat scroll area
- No TranscriptSubtitle widget is visible

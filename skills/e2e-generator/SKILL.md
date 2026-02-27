# /e2e-new

Create new end-to-end tests for the Fletcher mobile app.

## Trigger

- "create/add/write an e2e test for X"
- `/e2e-new`

## Workflow

### 1. Determine the next test number

List existing tests and pick the next sequential number:

```sh
ls e2e/tests/*.md | sort | tail -1
```

If the highest is `003-health-panel.md`, the next file is `004-<slug>.md`.

### 2. Explore the app — understand what's testable

Capture the current screen state so you can see what UI elements and flows are available:

```sh
e2e/helpers/emu-capture.sh explore-current
```

Read the screenshot at `e2e/captures/explore-current.png` to understand the current app state. If the app isn't running, launch it first:

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell am start -n com.fletcher.fletcher/.MainActivity
sleep 3
e2e/helpers/emu-capture.sh explore-current
```

### 3. Design test steps

Based on the user's description and the current app state:

- Break the scenario into sequential steps
- Each step should have one or two `sh` commands and clear `**Expect:**` assertions
- Use `<X> <Y>` placeholders for tap coordinates (the runner resolves these visually)
- Include timing instructions: "Wait N seconds" for fixed delays, "Wait up to N seconds" for poll loops

### 4. Generate audio fixtures (if needed)

If the test involves the user speaking, generate fixture WAV files via Cartesia TTS:

```sh
e2e/helpers/emu-speak.sh --generate "The phrase to speak" fixture-name
```

This creates `e2e/fixtures/audio/fixture-name.wav`. The `--generate` flag calls the Cartesia TTS API (requires `CARTESIA_API_KEY` in `.env`) — this is a one-time operation, never called during test runs.

**Important:**
- Fixtures live in `e2e/fixtures/audio/<name>.wav` and MUST be committed to git.
- The script refuses to overwrite existing fixtures. Delete the file first to regenerate.
- `CARTESIA_VOICE_ID` and `CARTESIA_MODEL` env vars can customize the voice/model.

In the test file, reference fixtures by name:

```sh
e2e/helpers/emu-speak.sh fixture-name
```

### 5. Write the test file

Create the markdown file at `e2e/tests/NNN-<slug>.md` following the format below.

### 6. Commit the test file and fixtures

```sh
git add e2e/tests/NNN-<slug>.md
git add e2e/fixtures/audio/*.wav  # if new fixtures were generated
```

Commit with a descriptive message: `test(e2e): add NNN <test description>`

### 7. Validate by running the test

Run the new test with the `/e2e` runner to confirm it passes:

```
/e2e NNN
```

If steps fail, iterate on the test file and re-run.

## Test file format

```markdown
# Test Title

Description of what this test verifies.

## Preconditions
- Emulator is running (`adb devices` shows the device)
- Fletcher APK is installed (`adb shell pm list packages | grep com.fletcher.fletcher`)

## Steps

### Step 1: Description of action

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell <command>
```

Wait 2 seconds, then capture state.

```sh
e2e/helpers/emu-capture.sh NNN-step1-label
```

**Expect:**
- Natural language assertion evaluated via screenshot
- Another assertion checked via logs

### Step 2: Description of next action

```sh
adb -s ${DEVICE_ID:-emulator-5554} shell input tap <X> <Y>
```

Wait 1 second.

```sh
e2e/helpers/emu-capture.sh NNN-step2-label
```

**Expect:**
- What should be visible after this action
```

### Conventions

- **File naming**: `NNN-<slug>.md` where NNN is zero-padded (001, 002, ...) and slug is kebab-case
- **Preconditions**: Always include emulator running + APK installed
- **Device ID**: Always use `${DEVICE_ID:-emulator-5554}` in adb commands
- **Capture labels**: Use `NNN-stepN-<descriptive>` format (e.g., `004-step2-after-tap`)
- **Tap coordinates**: Use `<X> <Y>` placeholders — the runner resolves them visually at runtime
- **Timing**:
  - "Wait N seconds" = literal `sleep N`
  - "Wait up to N seconds" = poll loop with captures every 3 seconds until assertions pass or timeout
- **Assertions**: Write in natural language describing what should be visible in the screenshot
- **Audio**: Reference committed fixtures by name: `e2e/helpers/emu-speak.sh fixture-name`

## Environment

- `DEVICE_ID` — Target device (default: `emulator-5554`)
- `CARTESIA_API_KEY` — Required for generating audio fixtures via `--generate`
- `CARTESIA_VOICE_ID` / `CARTESIA_MODEL` — Optional voice/model customization
- Test files: `e2e/tests/*.md`
- Audio fixtures: `e2e/fixtures/audio/*.wav` (committed)
- Capture helper: `e2e/helpers/emu-capture.sh`
- Audio helper: `e2e/helpers/emu-speak.sh`

# /e2e

Run end-to-end tests for the Fletcher mobile app via adb and vision.

## Trigger

- "run e2e test NNN" (e.g., "run e2e test 001")
- "run all e2e tests"
- "/e2e" or "/e2e 001"

## Workflow

### 1. Ensure preconditions

Run the preconditions helper:

```sh
skills/e2e-test-runner/check-preconditions.sh
```

The script auto-fixes issues when possible (starts emulator, builds/installs APK, launches app). Lines prefixed `FIX` indicate successful remediation and are treated as passing. If any line shows `FAIL`, stop and report the failure. Do not proceed with test steps.

### 2. Identify test files

- **Single test**: Read `e2e/tests/NNN-*.md` (e.g., `e2e/tests/001-app-launch.md`)
- **All tests**: Read all `e2e/tests/*.md` files, sorted by filename

### 3. Execute each test

For each test file, process steps sequentially:

#### a. Parse the test

- `## Preconditions` — Already verified in step 1
- `### Step N: <description>` — Steps to execute in order
- Code blocks tagged `sh` — Commands to run
- `**Expect:**` — Assertions to evaluate after the step

#### b. Run step commands

Collect all `sh` code block commands from the step and run them via the helper:

```sh
skills/e2e-test-runner/run-step.sh "cmd1" "cmd2" ...
```

#### c. Handle SKIP commands (coordinate placeholders)

When `run-step.sh` outputs `SKIP` for a command containing `<X> <Y>` placeholders:

1. Capture the current screen:
   ```sh
   e2e/helpers/emu-capture.sh step-tap
   ```
2. Read the screenshot at `e2e/captures/step-tap.png`
3. Visually identify the target element described in the step text
4. Substitute `<X>` and `<Y>` with the identified pixel coordinates
5. Run the command directly:
   ```sh
   adb -s ${DEVICE_ID:-emulator-5554} shell input tap X Y
   ```

#### d. Handle timing instructions

- **"Wait N seconds"** — Run `sleep N`
- **"Wait up to N seconds"** — Poll loop:
  1. Run `e2e/helpers/emu-capture.sh poll-<step>-<attempt>`
  2. Read the screenshot and evaluate `**Expect:**` assertions
  3. If assertions pass, move on
  4. If not, `sleep 3` and retry
  5. After N seconds total, record as FAIL with timeout note

#### e. Evaluate assertions

After each step completes (and after any "Wait" instructions):

1. If no capture was taken yet in this step, capture now:
   ```sh
   e2e/helpers/emu-capture.sh NNN-stepN-verify
   ```
2. Read the screenshot at `e2e/captures/<label>.png`
3. Evaluate each bullet under `**Expect:**` against what is visible in the screenshot
4. Record the step as PASS (all assertions met) or FAIL (any assertion failed)
5. If a step FAILs, mark all remaining steps as SKIP

### 4. Print report

After all steps complete, print the ASCII report table:

```
┌─────┬──────────────────────┬────────┬────────────────────────────────┐
│ #   │ Step                 │ Result │ Notes                          │
├─────┼──────────────────────┼────────┼────────────────────────────────┤
│ 0   │ Preconditions        │ ✅ PASS │ Emulator running, APK found    │
│ 1   │ Force-stop the app   │ ✅ PASS │                                │
│ 2   │ Launch the app       │ ✅ PASS │ "Connecting..." badge visible  │
│ 3   │ Wait for idle state  │ ❌ FAIL │ Timed out — still "Connecting" │
└─────┴──────────────────────┴────────┴────────────────────────────────┘
Result: ❌ FAIL (3/4 passed) — 001-app-launch
```

**Rules:**
- Step `0` is always precondition verification
- Result icons: `✅ PASS`, `❌ FAIL`, `⏭️ SKIP` (if a prior step failed)
- `Notes` column: key evidence from screenshots or logs

### 5. Multi-test summary

When running multiple tests, print one table per test, then a combined summary:

```
┌───────┬──────────────────┬─────────┬───────────────┐
│ Test  │ Name             │ Result  │ Steps         │
├───────┼──────────────────┼─────────┼───────────────┤
│ 001   │ App Launch       │ ✅ PASS │ 4/4 passed    │
│ 002   │ Mute Toggle      │ ✅ PASS │ 4/4 passed    │
│ 003   │ Health Panel     │ ❌ FAIL │ 3/4 passed    │
└───────┴──────────────────┴─────────┴───────────────┘
Suite: ❌ FAIL (2/3 tests passed)
```

## Token-saving tips

- Use `run-step.sh` to batch commands — one tool call per step, not per command
- Use `check-preconditions.sh` instead of running three separate adb checks
- Only read screenshots when evaluating assertions or resolving coordinates
- Avoid reading `.xml` or `.log` captures unless screenshot evidence is ambiguous

## Environment

- `DEVICE_ID` — Target device (default: `emulator-5554`)
- Test files: `e2e/tests/*.md`
- Captures: `e2e/captures/` (gitignored)
- Shared script: `scripts/ensure-mobile-ready.sh` (emulator + APK + app setup)
- Skill helpers: `skills/e2e-test-runner/` (check-preconditions.sh, run-step.sh)
- Capture helper: `e2e/helpers/emu-capture.sh`

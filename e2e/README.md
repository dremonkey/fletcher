# E2E Test Framework

Natural-language end-to-end tests for the Fletcher mobile app, executed by Claude Code via `adb`.

## Why This Approach

The Flutter UI is still evolving. Traditional E2E frameworks (Patrol, Appium) break whenever the UI changes, creating expensive maintenance overhead. Instead, tests are written in plain English and executed by Claude Code, which uses screenshots (vision) and logs to evaluate assertions. As the UI stabilizes, these tests become specs for porting to Patrol.

## How It Works

Claude Code is the test runner:

1. Reads the test markdown file
2. Verifies preconditions via `adb` commands
3. Executes each step's `sh` code blocks
4. Runs `emu-capture.sh` at each capture point
5. Reads the screenshot (vision) + logs to evaluate `**Expect:**` assertions
6. Reports results as an ASCII table (see Report Format below)

## Report Format

After running tests, Claude Code outputs a summary table:

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
- `Notes` contains the key evidence: what was seen in the screenshot or logs
- When running multiple tests, print one table per test followed by a combined summary:

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

## Writing Tests

Test files live in `e2e/tests/` as numbered markdown files.

### Format

```markdown
# Test Title

Description of what this test verifies.

## Preconditions
- Condition checked via adb (e.g., emulator running, APK installed)

## Steps

### Step 1: Description
Instructions and adb commands in sh code blocks.

\`\`\`sh
adb shell am start -n com.fletcher.fletcher/.MainActivity
\`\`\`

**Expect:**
- Natural language assertion evaluated via screenshot
- Another assertion checked via logs
```

### Key Rules

- **`## Preconditions`** — Claude Code verifies these before running any steps (using `adb devices`, `pm list packages`, etc.)
- **`### Step N`** — Steps execute sequentially. `sh` code blocks are run literally via `adb`.
- **`**Expect:**`** — Bulleted assertions evaluated via screenshot vision + log analysis.
- **Timing**: "Wait N seconds" means a literal `sleep N`. "Wait up to N seconds" means poll with captures every 3 seconds until assertions pass or timeout.
- **Tap coordinates**: Use `<X> <Y>` placeholders. Claude Code captures a screenshot, visually identifies the element, and substitutes real coordinates.

## Running Tests

### Setup

Install the `/e2e` skill so Claude Code knows the test runner workflow:

```sh
bun run skills:install
```

Select `e2e-test-runner` from the menu. This symlinks the skill into `.claude/commands/`.

### Running

Ask Claude Code (or use the `/e2e` slash command):

- **Single test**: "Run e2e test 001" or `/e2e 001`
- **All tests**: "Run all e2e tests" or `/e2e`
- **Specific step**: "Run step 2 of e2e test 003"

The skill uses its own helper scripts (`skills/e2e-test-runner/check-preconditions.sh`, `run-step.sh`) to verify the emulator is ready and batch-execute commands for each step, minimizing token usage.

## Capture Helper

`e2e/helpers/emu-capture.sh` captures emulator state in a single command:

```sh
./e2e/helpers/emu-capture.sh <label>
```

Produces three files in `e2e/captures/`:

| File | Source | Purpose |
|------|--------|---------|
| `<label>.png` | `adb shell screencap` | Screenshot for visual assertions |
| `<label>.xml` | `adb shell uiautomator dump` | UI hierarchy (system dialogs only — Flutter renders to a single surface) |
| `<label>.log` | `adb logcat` filtered by app PID | Last 200 log lines for the app |

**Environment variables:**
- `DEVICE_ID` — Target device (default: `emulator-5554`, matches `scripts/run-mobile.sh`)

## Limitations

- **Flutter renders to a single GPU surface.** `uiautomator` cannot see individual Flutter widgets. All UI assertions rely on Claude Code's vision analyzing screenshots.
- **Tap coordinates are resolution-dependent.** Tests include layout hints (e.g., "bottom center, ~48px from safe area") but Claude Code must verify coordinates visually for the actual device resolution.
- **No parallel execution.** Tests run sequentially against a single emulator.
- **Flaky by nature.** Animation timing, network latency, and rendering can cause intermittent failures. The poll-and-retry pattern ("Wait up to N seconds") mitigates this.

## Directory Structure

```
e2e/
├── README.md                # This file
├── helpers/
│   └── emu-capture.sh       # Screenshot + UI dump + logcat capture
├── tests/
│   ├── 001-app-launch.md    # App launch → connecting → idle
│   ├── 002-mute-toggle.md   # Mute/unmute cycle
│   └── 003-health-panel.md  # Open and verify diagnostics panel
└── captures/                # Gitignored — capture output
    └── .gitkeep

scripts/
└── ensure-mobile-ready.sh   # Shared: ensure emulator + APK + app are ready

skills/e2e-test-runner/
├── SKILL.md                 # Skill definition (installed via bun dev or bun run skills:install)
├── check-preconditions.sh   # Delegates to scripts/ensure-mobile-ready.sh
└── run-step.sh              # Batch-run step commands
```

## Future

When the UI stabilizes, these markdown tests serve as specifications for porting to Patrol (Flutter's native integration test framework). Each `**Expect:**` block maps to a Patrol `expect()` call, and each `sh` code block maps to a Patrol finder/tap action.

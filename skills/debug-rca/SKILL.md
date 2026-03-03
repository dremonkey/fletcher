---
name: debug-rca
description: Deep-dive debugging and root-cause analysis of a bug. Builds a theory, grounds it in code, iterates until confident, then writes a fix plan. Use when investigating a specific bug or failure.
argument-hint: <BUG-ID or description>
---

Investigate and root-cause: $ARGUMENTS

You are performing a **deep root-cause analysis** of a bug. Your goal is to understand *exactly* why the failure happens — grounded in actual source code, not guesses — and produce a fix plan with specific code changes.

## Mindset

- **Skeptical.** Every theory must be verified against real code. If you can't find the line that proves it, the theory is incomplete.
- **Iterative.** Your first theory will probably be wrong or incomplete. That's expected. Refine it.
- **Thorough.** Follow the full chain of events from trigger to symptom. Don't stop at the first error — trace what *caused* the error.
- **Precise.** Cite file paths and line numbers. Quote the relevant code. The task file you produce should let someone implement the fix without re-investigating.

## Workflow

### Phase 0: Identify the Bug

If `$ARGUMENTS` does not clearly specify a buglog file, ask the user which buglog to investigate:

```
ls docs/field-tests/*-buglog.md
```

Present the available buglogs and ask the user to pick one (and optionally a specific BUG-NNN entry within it). Read the selected buglog in full before proceeding.

If the user provided a BUG-ID (e.g., `BUG-019`), search across all buglogs for that ID:
```
grep -rl 'BUG-019' docs/field-tests/
```

### Phase 1: Gather Context

Before theorizing, collect all available evidence.

#### a. Read the bug report

Read the buglog file identified in Phase 0. For the specific bug entry, note:
- The exact error message and stack trace
- Timestamps and frequency
- What the user was doing when it happened
- Any prior analysis or theories

Then check for an existing task file:
```
find tasks/ -name '*.md' | xargs grep -l 'BUG-NNN'
```

#### b. Read the raw logs

Check for raw log files from the same session (same date prefix in `docs/field-tests/`):
```
ls docs/field-tests/YYYYMMDD-*.txt
```

Read the relevant log files. Focus on the 30-60 seconds *before* the error — the root cause is usually upstream of the symptom.

If raw logs aren't available and this is a live issue, pull fresh logs:
- **Voice agent:** `docker compose logs --since 30m voice-agent 2>&1`
- **LiveKit server:** `docker compose logs --since 30m livekit 2>&1`
- **Client (if device connected):** `adb logcat -d -t 2000`

### Phase 2: Theory → Code → Revise (iterate)

This is the core of the investigation. You will cycle through these steps until you are confident in the root cause.

#### a. Form a theory

Based on the evidence, write down a theory of what's happening. Be specific:
- What is the trigger?
- What is the expected behavior?
- What actually happens instead?
- Where in the code does the expected path diverge from the actual path?

#### b. Ground it in code

Read the **actual source code** that your theory implicates. Not summaries, not docs — the real code. For each claim in your theory, find the line that proves or disproves it.

Key areas to check (adjust based on the bug):

| Component | Source location |
|-----------|----------------|
| Ganglia LLM streams | `packages/livekit-agent-ganglia/src/llm.ts` |
| Ganglia client | `packages/livekit-agent-ganglia/src/client.ts` |
| Ganglia factory | `packages/livekit-agent-ganglia/src/factory.ts` |
| Voice agent setup | `apps/voice-agent/src/agent.ts` |
| LiveKit agents SDK | `node_modules/.bun/@livekit+agents@*/node_modules/@livekit/agents/src/` |
| LiveKit voice pipeline | Same path, under `src/voice/` |
| Flutter app services | `apps/mobile/lib/services/` |
| Flutter app widgets | `apps/mobile/lib/widgets/` |

**Important:** When investigating SDK behavior, read the **source** (`src/`) not the compiled output (`dist/`). Find the correct version:
```sh
find node_modules/.bun -path '*@livekit+agents*/src/llm/llm.ts' | head -3
```

For each piece of the theory:
- Find the exact file and line number
- Quote the relevant code snippet
- State whether it **confirms** or **refutes** the theory

#### c. Check how similar systems handle it

If the bug involves an interface or pattern (e.g., an SDK base class that plugins implement), look at:
- Other implementations of the same interface in `node_modules/`
- The SDK's own internal usage of the pattern
- Test files that demonstrate expected behavior

This often reveals the *intended* usage that our code diverges from.

#### d. Revise the theory

Based on what you found in the code:
- What parts of the theory were confirmed?
- What parts were wrong?
- What new questions emerged?

Write the revised theory and go back to step (b). Repeat until:
1. Every claim is backed by a specific code reference
2. You can trace the full chain from trigger to symptom with no gaps
3. You understand *why* the code behaves this way (design intent vs bug)

### Phase 3: Write the Fix Plan

Once you are confident in the root cause, write a comprehensive task file.

#### a. Find or create the task file

Check if a task file already exists:
```sh
find tasks/ -name '*relevant-keyword*'
```

- **If it exists:** Update it with your findings. Preserve any still-valid content.
- **If not:** Create a new one in the appropriate `tasks/` subdirectory.

#### b. Task file structure

The task file must contain these sections:

```markdown
# Task: [imperative description]

## Problem
What goes wrong, from the user's perspective. Reference field test bug IDs.

## Investigation
Your full theory → code → revise chain. This is the most important section.
Show your work:
- Each theory iteration
- The code references that confirmed/refuted it
- The key insight that cracked it

Include file paths, line numbers, and code quotes.

## Proposed Fix
Specific code changes, written as diffs or before/after snippets.
For each change:
- What file and line
- What to change
- Why this change fixes the root cause (not just the symptom)

## Edge Cases
What could go wrong with the fix? Consider:
- Race conditions
- Double-close / double-init scenarios
- What happens under rapid repetition
- What happens when the fix interacts with other components
- Whether the fix changes any existing behavior (intentionally or not)

## Acceptance Criteria
- [ ] Testable conditions that prove the fix works
- [ ] Include both positive tests (bug is fixed) and negative tests (nothing else broke)

## Files
List of files to modify.

## Status
Date, priority, current status.
```

#### c. Verify completeness

Before finishing, check:
- [ ] Can someone implement the fix from this task file alone, without re-investigating?
- [ ] Are all code references accurate (file paths, line numbers, quoted code)?
- [ ] Does the fix address the root cause, not just the symptom?
- [ ] Are edge cases considered?
- [ ] Is there a way to test the fix?

### Phase 4: Link Task to Bug

After creating or updating the task file, **update the buglog entry** to link back to it:

1. In the buglog file, add a `**Task:**` line to the relevant BUG-NNN entry:
   ```markdown
   **Task:** [`tasks/XX-epic/NNN-short-name.md`](../../tasks/XX-epic/NNN-short-name.md)
   ```

2. If the bug entry has a "New Issues Identified" section at the bottom of the buglog, update its status from `OPEN` to `RCA COMPLETE` and replace the `**Proposed fix:**` with `**Root cause:**` (one-line summary) and the `**Task:**` link.

3. Update `tasks/SUMMARY.md` to include the new task in the relevant epic section.

### Phase 5: Commit

Commit the task file and updated bug logs together:
```
docs(tasks): root-cause analysis for BUG-NNN — [short description]
```

## Anti-Patterns

- **Don't guess.** If you're not sure what a function does, read it. "I think this probably..." is not good enough.
- **Don't stop at the first error.** The logged error is usually a symptom. Trace backward to find the cause.
- **Don't propose fixes before understanding.** A try/catch around the symptom is not a fix if you don't understand why the error occurs.
- **Don't read compiled/minified code** (`dist/`) when source (`src/`) is available. Line numbers in stack traces map to `dist/` but always cross-reference with `src/`.
- **Don't over-scope the fix.** Fix the bug you're investigating. If you discover adjacent issues, note them as separate bugs — don't bundle them into one change.

## Tips

- **Stack traces lie** (sometimes). The error location is where it *throws*, not where it *originates*. Trace the values backward.
- **Check the constructor.** Many SDK classes set up event listeners, timers, or background tasks in the constructor. Side effects in constructors are a common source of ordering bugs.
- **Search for other callers.** When you find the broken function, search for other places that call it. They may have the same bug, or they may show the *correct* usage pattern.
- **Compare with Python.** The `@livekit/agents` Node SDK is a port of the Python SDK. If behavior is unclear, the Python version may have more comments or clearer structure. Check `node_modules/.bun/@livekit+agents*/node_modules/@livekit/agents/` for any Python references in comments.

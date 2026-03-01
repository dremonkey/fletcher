---
name: field-test
description: Enter field-test monitoring mode. Tail voice pipeline logs, catch errors, fix issues, and maintain a bug log while a human tester uses the app on a mobile device. Use when starting a field test session.
argument-hint: [notes]
---

Field-test monitoring session. Tester notes: $ARGUMENTS

You are the **monitor** in a live field-testing session. A human tester is using the Fletcher mobile app on a real device (typically outdoors or away from the terminal). Your job is to watch the backend logs in real time, catch issues, fix what you can, and maintain a structured bug log.

## Workflow

### 1. Ensure services are running

Verify that both Docker containers are up and the voice agent is registered:

```sh
docker compose ps --format '{{.Name}}\t{{.State}}'
```

Both `livekit` and `voice-agent` must show `running`. If not, start them:

```sh
docker compose up -d
```

Then poll for agent readiness:

```sh
docker compose logs --tail 50 voice-agent 2>&1 | grep -c "registered worker"
```

If 0, wait a few seconds and retry (up to 30s). Do not proceed until the agent is registered.

### 2. Create today's bug log

Check for an existing buglog for today:

```sh
ls docs/field-tests/$(date +%Y%m%d)-buglog.md 2>/dev/null
```

- **If it exists:** Read it. You are resuming a session — continue appending entries with the next available BUG-NNN number.
- **If it doesn't exist:** Create a new one from the template below.

#### Buglog template

```markdown
# Fletcher Bug Log — Field Testing Session

**Date:** YYYY-MM-DD
**Tester:** ahanyu (device info, location)
**Monitor:** Claude (watching logs, investigating issues)

---

## Session Summary

| Time (UTC) | Severity | Description | Status |
|------------|----------|-------------|--------|

---

## Detailed Entries

(entries will be added below as issues are discovered)

---

## Notes

- Command phrase: "Peanuts and Watermelons" = instruction from tester
- Services monitored: `livekit`, `voice-agent` (via `docker compose logs -f`)
```

### 3. Start tailing logs

Start a background log tail for both containers:

```sh
docker compose logs -f --tail 100 2>&1
```

Run this with `run_in_background: true`. This is your primary data source for the rest of the session.

### 4. Monitor loop

Periodically check the background log output (every 30-60 seconds, or when the user asks about something). For each check:

#### a. Scan for errors

Look for these patterns in the log output:

| Pattern | Severity | Example |
|---------|----------|---------|
| `ERROR` | HIGH | Cartesia TTS errors, HTTP failures |
| `FATAL` | CRITICAL | Service crashes, unhandled exceptions |
| `WARN` + repeated | MEDIUM | DTLS timeouts, connection issues |
| `could not` / `failed to` | HIGH | Participant restart failures |
| `AbortError` | MEDIUM | Stream cancellations (may indicate audio route issues) |
| `timeout` / `deadline exceeded` | MEDIUM | ICE/DTLS/HTTP timeouts |
| `voice not found` / `invalid transcript` | HIGH | TTS provider errors |

#### b. Classify each issue

For each new issue found, determine:

1. **Is it new?** Check if already logged in the buglog (same error, same root cause).
2. **Severity:** CRITICAL (breaks pipeline), HIGH (degraded UX), MEDIUM (intermittent), LOW (cosmetic), INFO (expected behavior).
3. **Is it actionable?** Can you fix it from here, or is it a mobile-side / external issue?

#### c. Log the issue

Add a new entry to the buglog with:

```markdown
### BUG-NNN: Short description (SEVERITY)

**First seen:** HH:MM:SS UTC
**Frequency:** Once / Intermittent / Every occurrence
**Impact:** What the user experiences

**Log excerpt:**
\```
(relevant log lines)
\```

**Analysis:** What's happening and why

**Root cause:** (if known)

**Fix applied:** (if fixed)
- Step 1
- Step 2

---
```

Also add a row to the Session Summary table.

#### d. Fix if possible

If the issue is fixable from the backend:

1. **Investigate** — Read relevant source files to understand the root cause.
2. **Fix** — Edit the code.
3. **Rebuild** — Rebuild the affected container:
   ```sh
   docker compose build voice-agent
   ```
4. **Restart** — Restart the service:
   ```sh
   docker compose up -d voice-agent
   ```
5. **Verify** — Watch logs to confirm the fix works when the tester's next interaction comes through.
6. **Update buglog** — Mark the entry as FIXED with timestamp.

If the issue is client-side or external, note it in the buglog as "Needs investigation" or "Client-side fix needed" and move on.

**Important:** After rebuilding, re-start the background log tail (step 3) since the old one will have ended when the container restarted.

### 5. Watch for "Peanuts and Watermelons"

This is the **tester command phrase**. When you see this phrase (or close variations) appear in STT transcripts in the logs, it means:

> The tester is about to describe a UX issue or behavior change request verbally. The speech that follows "Peanuts and Watermelons" is an instruction, not a conversation with the agent.

When you spot it:

1. **Pay close attention** to the STT transcripts that follow in the logs.
2. The tester will describe what they observed and what they think should change.
3. **Log it as a bug/UX issue** in the buglog, even if there are no backend errors. Use the tester's own words as the description, then add your analysis.
4. Mark these entries with a special tag: `(TESTER REPORT)` in the severity field.

Example:
```markdown
### BUG-007: Agent responds to background TV audio (TESTER REPORT)

**First seen:** 19:45:12 UTC
**Trigger phrase:** "Peanuts and Watermelons"
**Tester said:** "The agent keeps responding when my kid is talking in the background. It should only listen to me."

**Analysis:** This is the speaker discrimination problem documented in task 007 (noise-robust voice detection). The agent has no way to distinguish the owner's voice from others.

**Related task:** `tasks/02-livekit-agent/007-noise-robust-voice-detection.md`
```

### 6. Session wrap-up

When the tester says the session is over (or you're asked to stop):

1. **Review the buglog** — Ensure all entries are complete with analysis and status.
2. **Check for missing tasks** — For each bug logged, verify a corresponding task exists in `tasks/`. If not, create one in the appropriate epic.
3. **Update SUMMARY.md** — If new tasks were created, update `tasks/SUMMARY.md`.
4. **Commit the buglog** — Stage and commit the buglog file.
5. **Print a session summary** — List all bugs found, their severity, and status.

## Tips

- **Don't flood the user with every log line.** Only report issues that are genuinely new or impactful. DTLS timeouts on disconnect are expected for mobile; don't report them unless they're excessive.
- **Correlate timestamps.** When you see an error, look at what happened in the 5-10 seconds before it — the root cause is often upstream.
- **Watch for cascades.** A single disconnect can produce 5+ error lines (DTLS timeout, participant close, room close, agent job failed). Log the root cause, not each symptom.
- **The user can't see the terminal.** They're on a phone outdoors. If you need them to do something specific (restart app, try a specific action), tell them in the chat.
- **AbortError bursts** often indicate audio route changes (BT transitions) — see `tasks/09-connectivity/009-bluetooth-audio-route-recovery.md`.
- **"Voice not found" / "Invalid transcript"** errors are TTS-layer issues — check the voice ID and chunk content.
- **Long silence after user speech** (visible as big gap between STT transcript and TTS output) is the TTFT latency issue — see `tasks/05-latency-optimization/005-openclaw-ttft-investigation.md`.

## Files

- Bug logs: `docs/field-tests/YYYYMMDD-buglog.md`
- Docker config: `docker-compose.yml`
- Voice agent: `apps/voice-agent/src/agent.ts`
- Ganglia: `packages/livekit-agent-ganglia/src/`
- Channel plugin: `packages/openclaw-channel-livekit/src/`
- Task tracking: `tasks/SUMMARY.md`

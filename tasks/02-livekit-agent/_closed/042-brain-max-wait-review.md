# TASK-042: Review BRAIN_MAX_WAIT_MS with Hold Mode

**Status:** [x] Complete — removed BRAIN_MAX_WAIT_MS entirely (option 2)
**Priority:** LOW
**Epic:** 2 — Voice Agent Pipeline

## Problem

`BRAIN_MAX_WAIT_MS` (default 60s) fires when the LLM produces no streaming content within 60s. When it fires, it calls `session.interrupt()` (kills the LLM stream) and shows "Brain Timed Out" to the client. This is **destructive** — the response is lost.

With hold mode in place (TASK-011, Epic 20), the "silence" case is handled cleanly: if the user is idle, the hold timer fires and the agent disconnects gracefully. The user gets "on hold — tap or speak to resume" instead of a lost response.

## Scenarios to Consider

| Scenario | BRAIN_MAX_WAIT_MS | Hold Mode |
|----------|-------------------|-----------|
| LLM genuinely processing (>60s) | Kills response (bad) | Not triggered (agent is in `thinking` state) |
| LLM hung / crashed | Kills stream, shows error | Not triggered (agent is in `thinking` state) |
| User idle, no LLM request | Not triggered | Fires, clean disconnect (good) |

The brain timeout is only useful for detecting hung LLM connections — a legitimate but rare scenario. For normal long-thinking operations (complex tool use, multi-step reasoning), it's destructive.

## Options

1. **Increase to 5 minutes** — gives complex operations room to complete while still catching hung connections
2. **Remove entirely** — rely on hold mode for idle detection, and ACP-level timeouts for hung connections
3. **Keep as-is** — 60s may be acceptable if OpenClaw/ACP never legitimately takes >60s for first content

## Dependencies

- Hold mode (TASK-011, Epic 20) — implemented
- Field testing to understand actual LLM response time distribution

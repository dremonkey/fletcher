# TASK-024: Diagnostics Panel — Live Pipeline Values

## Status
- **Status:** Open
- **Priority:** Low
- **Depends on:** 019 (Live Diagnostics Status Bar)
- **Owner:** Unassigned
- **Created:** 2026-03-07

## Bug Reference
- **BUG-013** in [`docs/field-tests/20260307-buglog.md`](../../docs/field-tests/20260307-buglog.md)
- **Screenshot:** [`docs/field-tests/20260307-diagnostics-panel.png`](../../docs/field-tests/20260307-diagnostics-panel.png)

## Problem

The diagnostics panel shows hardcoded/placeholder values for pipeline components instead of reading from actual configuration. Several fields are never populated with live data.

**Incorrect values:**
- `TTS: cartesia` — actual provider is Google TTS
- `STT: deepgram` — may or may not be correct, but appears hardcoded rather than dynamic

**Unpopulated fields (stuck at `--`):**
- `RT` (round-trip latency)
- `SESSION`
- `AGENT`
- `UPTIME`

## Proposed Fix

1. **Read pipeline config from env vars or server-reported metadata** instead of hardcoded strings for STT, TTS, and LLM fields.
2. **Wire up live values** for RT, SESSION, AGENT, and UPTIME from the LiveKit room/agent state.
3. Ensure values update dynamically if the pipeline configuration changes mid-session.

## Acceptance Criteria
- [ ] STT field reflects the actual STT provider in use
- [ ] TTS field reflects the actual TTS provider in use
- [ ] LLM field reflects the actual LLM backend in use
- [ ] RT field shows measured round-trip latency (or `--` only when no measurement is available yet)
- [ ] SESSION field shows current session identifier
- [ ] AGENT field shows agent connection status or identity
- [ ] UPTIME field shows session duration
- [ ] No hardcoded provider names in the diagnostics widget

# TASK-024: Diagnostics Panel — Live Pipeline Values

## Status
- **Status:** Complete
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
- [x] STT field reflects the actual STT provider in use (shows `--` until agent sends `pipeline_info` event)
- [x] TTS field reflects the actual TTS provider in use (shows `--` until agent sends `pipeline_info` event)
- [x] LLM field reflects the actual LLM backend in use (shows `--` until agent sends `pipeline_info` event)
- [x] RT field shows measured round-trip latency (or `--` only when no measurement is available yet)
- [x] SESSION field shows current session identifier
- [x] AGENT field shows agent connection status or identity
- [x] UPTIME field shows session duration
- [x] No hardcoded provider names in the diagnostics widget

## Implementation Notes

### Changes Made
- **`DiagnosticsInfo` model** (`conversation_state.dart`): New data class holding round-trip latency, session name, agent identity, connection timestamp, and pipeline provider names (STT/TTS/LLM). Includes `formatUptime()` for duration formatting.
- **`LiveKitService`**: Populates diagnostics on room connect (session name, connected timestamp, agent identity). Measures RT latency as the time between user speech ending and agent speech starting. Handles `pipeline_info` data channel events for provider names.
- **`DiagnosticsBar`**: Accepts `DiagnosticsInfo` and displays live RT value in the status bar.
- **`_DiagnosticsModal`**: Converted from `StatelessWidget` to `StatefulWidget` with a 1-second Timer to update the UPTIME display. All hardcoded provider strings (`deepgram`, `cartesia`, `openclaw`) replaced with dynamic values from `DiagnosticsInfo`.
- **Tests**: 24 tests covering both the bar and modal, including RT display, session/agent/uptime rendering, provider metadata, formatUptime logic, and copyWith semantics.

### Pipeline Provider Names
The voice agent does not currently publish pipeline metadata. STT/TTS/LLM fields show `--` until the agent sends a `pipeline_info` event on the `ganglia-events` data channel. This is forward-compatible: when the agent adds `pipeline_info` publishing, the mobile app will automatically display the values.

# TASK-038: Enable Verbose ACP Trace for Brutalist Tool-Feedback

**Status:** Backlog
**Epic:** [[EPIC.md]] (UI/UX) / [[../23-relay-native-rewrite/EPIC.md]] (Relay)

## Problem
The current Fletcher UI feels "frozen" or "stuck" during deep searches or long tool executions because the OpenClaw gateway filters out internal `tool_call`, `plan`, and `reasoning` chunks by default. The user hears silence and sees no activity until the final text response arrives.

## Goal
Force the OpenClaw ACP session into `verbose` mode so that internal tool calls and planning chunks are emitted on the wire. This allows the Relay to forward them and the Mobile client to render subtle "thinking" indicators (e.g., `[SEARCHING...]`, `[CALLING: memory_search]`).

## Requirements
- [ ] **Relay:** Update the `AcpClient` to request `verbose: true` (or the equivalent thinking-level) during `session/new` or via a `/debug` command immediately after creation.
- [ ] **Relay:** Ensure `acp_update_received` logging in the Relay correctly identifies and logs these new chunk types (`plan`, `tool_call`, `reasoning`).
- [ ] **Mobile:** Update `AcpUpdateParser` to recognize `tool_call` and `plan` updates.
- [ ] **Mobile:** Implement a "System Trace" or "Tool Pulse" indicator in the Brutalist UI that renders these updates (or at least blinks an LED when they arrive).
- [ ] **Filter-Friendly:** Ensure the text-only chat bubble *ignores* these verbose chunks so the primary transcript remains clean, while the "Status Bar" or "Diagnostics Panel" reflects the live tool-use.

## Technical Notes
- OpenClaw's ACP `session/new` params or the `/think` / `/verbose` commands are the entry points.
- The Relay should handle the "un-filtering" while the Mobile client handles the "rendering/filtering" logic.
- Related to **BUG-001** (Schema mismatch) — we now have the passthrough logic, we just need the data.

## Definition of Done
- [ ] Relay logs show `tool_call` and `plan` chunks arriving from ACP.
- [ ] Mobile client receives these chunks via the Relay bridge.
- [ ] User sees some form of visual feedback on the phone when the agent is using a tool.

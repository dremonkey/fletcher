# Task 010: ACPX Integration (OpenClaw Bridge)

**Goal:** Integrate `acpx` into the `fletcher-relay` so that it can utilize OpenClaw as an ACP-compatible agent. This fulfills the requirement from Peter Steinberg's announcement that `acpx` now supports a built-in OpenClaw bridge.

## Context
Peter Steinberg (OpenClaw creator) announced that `acpx` has been extended to connect to OpenClaw via ACP. This allows harder tasks that a standard coding agent (like Codex or Claude Code) might struggle with to be offloaded to an OpenClaw instance.

In `fletcher-relay`, we can now use `acpx` as the execution engine to bridge the Relay's WebSocket/JSON-RPC interface to a local or remote OpenClaw instance.

## Requirements
- [ ] Install `acpx` as a dependency (or use `npx acpx`).
- [ ] Configure `fletcher-relay` to support `acpx` as an agent provider.
- [ ] Implement `runAcpxAgent` in `src/session/agent-bridge.ts`.
- [ ] Add configuration options to `openclaw.json` or `config.json` for the OpenClaw ACP endpoint/token.
- [ ] Verify that `acpx openclaw exec` or `acpx openclaw prompt` commands work within the relay session.

## Implementation Plan
1. **Dependency:** Check if `acpx` should be a devDependency or a runtime requirement.
2. **Bridge Update:** Update `src/session/agent-bridge.ts` to include a new `runAcpxAgent` function.
3. **Command Mapping:** Map `acpx` output streams (thinking, tool_call, text_delta) to our `session/update` JSON-RPC notifications.
4. **Auth:** Ensure the OpenClaw gateway token and workspace session keys are passed through `acpx` flags.

## Reference
- github.com/openclaw/acpx
- [acpx README](https://github.com/openclaw/acpx/blob/main/README.md)
- PETER'S TWEET: "extended acpx so it connects to openclaw via acp... Now I can access Molty in codex!"

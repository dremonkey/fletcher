# Task: Remove working directory prefix from chat messages

## Background

Found during field testing (2026-03-12, BUG-003). Every chat message sent by
the mobile app is prefixed with `[Working directory: <path>]` before reaching
OpenClaw. This prefix:

- Wastes tokens on every prompt
- Looks like a developer console, breaking the "Warm and Grounded" UX aesthetic
- Is meaningless for a mobile app that has no concept of a working directory

## Investigation

The prefix was not found in any Flutter source files — it is likely injected
by OpenClaw itself (e.g., its default system prompt or ACP session configuration)
rather than the mobile app. The relay transparent passthrough means the relay
does not modify message content.

**Next steps:**
1. Check OpenClaw's default system prompt / ACP session init for a cwd injection
2. Check if ACP `session/new` params accept a `cwd: null` field to suppress it
3. If it's an OpenClaw system prompt default, override it via the `systemPrompt`
   field in the ACP session initialization in the relay (`apps/relay/src/acp/client.ts`)

## Proposed Fix

If the prefix is injected by OpenClaw based on the absence of a `cwd` override,
pass `cwd: null` or `cwd: ""` in the ACP `session/new` params.

If it's a system prompt issue, set a custom system prompt in the relay that does
not include the cwd line, or explicitly suppresses it.

## Checklist

- [ ] Identify where the prefix is injected (OpenClaw default vs relay vs mobile)
- [ ] Suppress or remove the prefix
- [ ] Verify chat messages no longer include the prefix
- [ ] Check that removing it doesn't break any tool calls that need cwd context

## Related

- Bug: `docs/field-tests/20260312-buglog.md` BUG-003
- `apps/relay/src/acp/client.ts` — ACP session initialization

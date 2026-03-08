# Task 022: E2E Test Room Name Convention

## Summary
Add a room name convention so e2e tests inject a bootstrap user message that keeps LLM responses short, reducing token consumption during automated testing.

## Problem
During e2e tests, the LLM/OpenClaw agent generates full conversational responses (greetings, follow-ups, etc.) that burn tokens unnecessarily. The agent doesn't know it's in an automated test.

Injecting system prompt overrides via data channel was considered and rejected — OpenClaw has significant permissions (tool use, API calls), so allowing any client-side system prompt modification is a prompt injection risk.

The initial approach used `voice.Agent({ instructions })` to set a system-level prompt, but OpenClaw has its own system prompt and may ignore client-side system messages.

## Solution
Use a **room name convention** to signal test mode, then send a **bootstrap user message** via `session.generateReply()` that flows through the normal LLM pipeline:

1. E2e tests generate room names with a distinct prefix (e.g., `e2e-fletcher-NNNN` instead of `fletcher-NNNN`)
2. The voice agent checks the room name after session routing is resolved
3. If the room matches the e2e pattern, `buildBootstrapMessage()` returns a user-role message instructing OpenClaw to keep responses brief
4. The message is injected via `session.generateReply({ userInput })` — flowing through the full voice pipeline to OpenClaw as a regular user message
5. Bootstrap messages end with "Do not reply to this message." — this sentinel is detected in `llm.ts` to skip the STT skepticism wrapper (since bootstrap messages are programmatic, not transcribed)
6. The trust boundary stays server-side — the client cannot influence the bootstrap message

### Bootstrap mechanism (`apps/voice-agent/src/bootstrap.ts`)
- Generic builder: `buildBootstrapMessage({ roomName, participantIdentity })` returns message text or `null`
- Currently supports e2e rooms; extensible for future mission briefing / silent handshake (EPIC 14)

## Implementation Checklist
- [x] Define the e2e room name prefix convention — `e2e-fletcher-<timestamp>`
- [x] Update the mobile app to use the e2e prefix when `E2E_TEST_MODE=true` in `.env`
- [x] Update the voice agent to detect `e2e-` room names and send bootstrap user message
- [x] Update the token server to accept e2e-prefixed room names — already accepts any format, no changes needed
- [x] E2e skill swaps `.env.e2e` → `.env` before build, restores after
- [x] Skip STT skepticism wrapper for bootstrap messages in `llm.ts`
- [ ] Verify token consumption reduction in a test run

## Security Notes
- The room name convention is enforced server-side — the agent decides its own behavior based on a naming pattern it recognizes
- No free-form text from the client influences the bootstrap message
- The token server should validate that e2e room names are only created in dev/test environments (not production)

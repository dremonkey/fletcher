# Task 022: E2E Test Room Name Convention

## Summary
Add a room name convention so e2e tests use a minimal system prompt that keeps LLM responses short, reducing token consumption during automated testing.

## Problem
During e2e tests, the LLM/OpenClaw agent generates full conversational responses (greetings, follow-ups, etc.) that burn tokens unnecessarily. The agent doesn't know it's in an automated test.

Injecting system prompt overrides via data channel was considered and rejected — OpenClaw has significant permissions (tool use, API calls), so allowing any client-side system prompt modification is a prompt injection risk.

## Solution
Use a **room name convention** to signal test mode on the server side:

1. E2e tests generate room names with a distinct prefix (e.g., `e2e-fletcher-NNNN` instead of `fletcher-NNNN`)
2. The voice agent checks the room name at dispatch time
3. If the room matches the e2e pattern, use a minimal system prompt: "You are in an automated test. Respond with short acknowledgments only."
4. The trust boundary stays server-side — the client cannot influence the system prompt

## Implementation Checklist
- [ ] Define the e2e room name prefix convention (e.g., `e2e-fletcher-`)
- [ ] Update the mobile app to use the e2e prefix when a flag/env var is set (e.g., `E2E_TEST_MODE=true`)
- [ ] Update the voice agent to detect e2e room names and swap the system prompt
- [ ] Update the token server to accept e2e-prefixed room names
- [ ] Verify token consumption reduction in a test run

## Security Notes
- The room name convention is enforced server-side — the agent decides its own behavior based on a naming pattern it recognizes
- No free-form text from the client influences the system prompt
- The token server should validate that e2e room names are only created in dev/test environments (not production)

# Task: End-to-End OpenClaw Integration

## Status: Not Started

Validate the full voice pipeline against a real OpenClaw Gateway. All existing ganglia tests mock the HTTP layer — this task verifies the contract holds in practice.

**Goal:** A voice conversation from the Flutter app, through LiveKit + ganglia, to the OpenClaw Gateway and back, with session continuity across reconnections.

---

## Phase 1: Gateway Endpoint Verification

### 1.1 Confirm `/v1/chat/completions` is live

- [ ] `curl` the OpenClaw Gateway at `$OPENCLAW_GATEWAY_URL/v1/chat/completions` with a minimal streaming request
- [ ] Verify SSE response format matches `OpenClawChatResponse` shape (id, choices, delta)
- [ ] Verify `Authorization: Bearer` auth works (and 401 on bad key)
- [ ] Document the Gateway version and any required config

### 1.2 Verify session contract

- [ ] Send a request with `user: "guest_e2e-test"` → verify isolated guest session (use this for all further tests)
- [ ] Send two requests with the same session key → verify conversation history is preserved (second response references first)
- [ ] Verify the `X-OpenClaw-*` metadata headers don't cause errors (even if ignored)

### 1.3 Verify tool calling round-trip

- [ ] Send a request that triggers a tool call from the Gateway
- [ ] Verify the `tool_calls` delta format matches `OpenClawToolCallDelta`
- [ ] Send the tool result back → verify the Gateway continues the response

---

## Phase 2: Voice Agent Smoke Test

> **IMPORTANT:** Do NOT use the owner's `main` session for testing. All e2e tests must connect with a **test participant identity** (e.g., `fletcher-e2e-test`) that does NOT match `FLETCHER_OWNER_IDENTITY`. This ensures tests route to a disposable guest session (`user: "guest_fletcher-e2e-test"`) and never pollute the owner's real conversation history.

### 2.1 Run voice agent against OpenClaw

- [ ] Set environment:
  ```bash
  GANGLIA_TYPE=openclaw
  OPENCLAW_GATEWAY_URL=<url>
  OPENCLAW_API_KEY=<key>
  FLETCHER_OWNER_IDENTITY=<owner>
  ```
- [ ] Start voice agent: `bun run apps/voice-agent/src/agent.ts dev`
- [ ] Connect Flutter app with a **test identity** (not the owner) to a room
- [ ] Speak → verify transcription reaches OpenClaw and response comes back as audio
- [ ] Verify the request uses `user: "guest_fletcher-e2e-test"` (not `x-openclaw-session-key: main`)
- [ ] Document any errors or contract mismatches

### 2.2 Session continuity test (guest)

- [ ] Connect as the test identity, speak, note the conversation context
- [ ] Disconnect (kill app or drop network)
- [ ] Reconnect with the **same test identity**
- [ ] Speak again → verify the agent remembers the prior conversation
- [ ] Verify this works because the guest session key is stable across rooms

### 2.3 Guest isolation test

- [ ] Verify the test identity's session has no access to the owner's history
- [ ] Verify the `user` body field is set correctly in Gateway logs

---

## Phase 3: Automated Integration Test (Optional)

### 3.1 Scripted smoke test

- [ ] Create `tests/integration/openclaw-smoke.ts` (or similar) that:
  - Creates a LiveKit room programmatically
  - Dispatches the voice agent
  - Sends a text message via data channel (simulating STT output)
  - Verifies a response comes back
  - Checks session key headers in the outgoing request
- [ ] Guard behind `INTEGRATION_TEST=true` env flag (don't run in CI by default)

---

## Success Criteria

- [ ] Voice agent successfully exchanges at least one turn with OpenClaw Gateway
- [ ] Session persists across room reconnection (guest identity routing)
- [ ] Guest sessions are isolated
- [ ] No contract mismatches between ganglia's HTTP requests and Gateway's expectations
- [ ] Any issues found are documented with concrete error messages / response dumps

## Dependencies

- Task 004 (Session Routing) — ✅ complete
- Access to a running OpenClaw Gateway instance with `/v1/chat/completions`

---

**Spec:** [`docs/specs/08-session-continuity/openclaw-implementation.md`](../../docs/specs/08-session-continuity/openclaw-implementation.md)

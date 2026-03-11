# 005: Agent Bridge

**Status:** Not Started
**Depends on:** 002, 004
**Blocks:** 008

## Objective

Implement the core bridge between the Agent SDK's async generator and WebSocket JSON-RPC notifications. This is the most important piece — it translates agent events into mobile-friendly messages.

## Files

- `src/session/agent-bridge.ts`

## Details

### `runAgent(session: Session, ws: ServerWebSocket<WebSocketData>): Promise<void>`

The main function. Given a session and WebSocket connection:

1. **Build the `canUseTool` callback:**
   - When `toolName === "AskUserQuestion"`: send a `session/question` notification with the questions array, then `await session.waitForUserResponse()` to get the answer. Return `{ behavior: "allow", updatedInput: { ...input, answers } }`.
   - For all other tools: send a `session/approval` notification with tool name and input, then `await session.waitForApproval()`. Return `{ behavior: "allow" }` or `{ behavior: "deny", message: "User denied" }`.

2. **Call `query()` from the Agent SDK:**
   - Pass `prompt` from the session (or the input channel for streaming mode)
   - Pass `canUseTool` callback
   - Pass `abortSignal: session.abortController.signal`

3. **Iterate the async generator:**
   - On `assistant` messages: send `session/update` notification with `type: "text_delta"` and extracted text content
   - On `tool_use` messages: optionally send `session/update` with `type: "tool_use"` for visibility
   - On `result` messages: send `session/complete` notification

4. **Error handling:**
   - Catch errors from the generator, send `session/error` notification
   - Handle abort signals gracefully (cancelled sessions)
   - Update session status throughout (`running` → `waiting_for_user` → `running` → `completed`)

### `waitForUserResponse` pattern

Add a helper on session or as a standalone:

```typescript
function waitForUserResponse(session: Session): Promise<unknown> {
  return new Promise((resolve) => {
    session.pendingResolve = resolve;
    session.status = "waiting_for_user";
  });
}
```

When the session manager's `sendMessage` is called and `pendingResolve` is set, it calls `pendingResolve(content)` and clears it.

## Key Considerations

- The Agent SDK may not be installed yet or its API may differ from what we expect. Implement against the expected interface and adapt when we wire it up. Use a clear abstraction boundary so the SDK interaction is isolated.
- If the SDK is unavailable, implement a mock/stub version that simulates the agent loop for testing.

## Acceptance Criteria

- `runAgent` drives the agent loop and emits JSON-RPC notifications
- Questions from agent pause execution and wait for client response
- Tool approvals pause execution and wait for client response
- Cancellation via AbortController stops the loop cleanly
- Errors are caught and sent as `session/error` notifications
- `tsc --noEmit` passes

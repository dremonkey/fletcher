# 004: Session Manager

**Status:** Not Started
**Depends on:** 003
**Blocks:** 005, 006, 007

## Objective

Implement the session lifecycle manager — create, message, cancel, resume, and list sessions.

## Files

- `src/session/manager.ts`

## Details

The session manager owns a `Map<string, Session>` and exposes these functions:

### `createSession(prompt: string, ws: ServerWebSocket<WebSocketData>): Session`

- Generate a unique session ID (e.g., `crypto.randomUUID()` truncated to 8 chars)
- Create an `AbortController`
- Create an `AsyncInputChannel`
- Store in the session map
- Return the session (does NOT start the agent — that's the agent bridge's job)

### `getSession(sessionId: string): Session | undefined`

- Lookup by ID

### `sendMessage(sessionId: string, content: string): void`

- Find the session
- If session has a `pendingResolve`, call it with the content (answering a question/approval)
- Otherwise push to the session's `inputChannel`
- Throw if session not found

### `cancelSession(sessionId: string): void`

- Find the session
- Call `abortController.abort()`
- Close the `inputChannel`
- Set status to `"cancelled"`

### `listSessions(): Array<{ id, status, createdAt, prompt }>`

- Return summary of all sessions

### `removeSession(sessionId: string): void`

- Delete from map (cleanup after completion)

### `updateSessionStatus(sessionId: string, status: SessionStatus): void`

- Update the status field

## Acceptance Criteria

- Sessions can be created, retrieved, messaged, cancelled, and listed
- `sendMessage` resolves pending promises when agent is waiting
- `sendMessage` pushes to input channel when agent is streaming
- Cancel aborts the agent loop via AbortController
- `tsc --noEmit` passes

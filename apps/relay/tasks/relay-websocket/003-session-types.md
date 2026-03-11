# 003: Session State Types

**Status:** Not Started
**Depends on:** 001
**Blocks:** 004

## Objective

Define the TypeScript types representing session state, used by the session manager and agent bridge.

## Files

- `src/session/types.ts`

## Details

Define these types:

### `SessionStatus`

Union type: `"idle" | "running" | "waiting_for_user" | "completed" | "error" | "cancelled"`

### `Session`

```typescript
interface Session {
  id: string;
  status: SessionStatus;
  createdAt: number;
  prompt: string;

  // WebSocket connection for this session
  ws: ServerWebSocket<WebSocketData>;

  // Pending promise resolver — set when agent is waiting for user input
  // (question answer or tool approval)
  pendingResolve: ((value: unknown) => void) | null;

  // Abort controller to cancel the agent loop
  abortController: AbortController;

  // Async input channel for streaming user messages into a running agent
  inputChannel: AsyncInputChannel | null;
}
```

### `WebSocketData`

Per-connection upgrade data attached by `Bun.serve()`:

```typescript
interface WebSocketData {
  connId: string;
}
```

### `AsyncInputChannel`

A simple push/pull async iterable for feeding user messages into the agent:

```typescript
interface AsyncInputChannel {
  push(message: unknown): void;
  close(): void;
  [Symbol.asyncIterator](): AsyncIterableIterator<unknown>;
}
```

Include a `createAsyncInputChannel()` factory function that returns an `AsyncInputChannel` backed by a queue and a pending promise.

## Acceptance Criteria

- All types exported and importable
- `createAsyncInputChannel()` works: push a value, async-iterate to receive it
- `tsc --noEmit` passes

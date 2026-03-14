# TASK-068: Forward ACP error details to mobile (rate-limit handling)

**Status:** [ ] Not started
**Priority:** Medium
**Epic:** 22 (Dual-Mode Architecture)
**Origin:** BUG-025, BUG-026 (field test 2026-03-14, 00:41 PDT)

## Problem

When upstream LLM errors (429 rate limit, gateway disconnect, etc.) occur, the
error detail is stripped at two layers before reaching the mobile client:

1. **ACP client** (`packages/acp-client/src/client.ts:384-386`): Converts the
   full JSON-RPC error `{code, message, data}` into a flat
   `Error("JSON-RPC error -32603: Internal error")`. The `data` field (which
   carries retry delays and quota details) is discarded.

2. **Relay bridge** (`apps/relay/src/bridge/relay-bridge.ts:405-412`): Catches
   the Error, forwards `err.message` with a hardcoded `INTERNAL_ERROR` code.
   The original ACP error code is lost.

Result: mobile shows `"Error: JSON-RPC error -32603: Internal error"` — opaque
and unhelpful.

Additionally, the relay has no `unhandledRejection` / `uncaughtException`
handlers, making it vulnerable to silent crashes from any unhandled error.

## Fix

### 1. Add process error handlers to relay (`apps/relay/src/index.ts`)

```typescript
process.on("uncaughtException", (err) => {
  log.fatal({ err }, "Uncaught exception");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  log.fatal({ err: reason }, "Unhandled rejection");
  process.exit(1);
});
```

### 2. Typed error in ACP client (`packages/acp-client/src/client.ts`)

Replace the flat `Error` string with a typed `AcpError` that preserves all
fields:

```typescript
export class AcpError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "AcpError";
  }
}
```

At line 384-386, change:
```typescript
// Before:
pending.reject(new Error(`JSON-RPC error ${err.code}: ${err.message}`));

// After:
const { code, message, data } = msg.error as { code: number; message: string; data?: unknown };
pending.reject(new AcpError(code, message, data));
```

### 3. Rate-limit detection in relay bridge (`apps/relay/src/bridge/relay-bridge.ts`)

In the `.catch()` handler (~line 405), detect rate-limit errors and use a
specific error code:

```typescript
.catch((err: Error) => {
  reqLog.error({ event: "acp_error", error: err.message });
  this.activeRequestSource = null;

  let errorCode = INTERNAL_ERROR;
  let errorMessage = err.message;

  if (err instanceof AcpError) {
    errorCode = err.code;
    const details = (err.data as any)?.details ?? "";
    if (/429|quota|rate.limit|RESOURCE_EXHAUSTED/i.test(`${err.message} ${details}`)) {
      errorCode = RATE_LIMITED;
      errorMessage = "Rate limited — try again shortly";
    }
  }

  this.forwardToMobile({
    jsonrpc: "2.0",
    id: msg.id,
    error: { code: errorCode, message: errorMessage },
  });
});
```

Apply the same pattern in the voice-acp handler (~line 465).

### 4. Add RATE_LIMITED error code (`apps/relay/src/rpc/errors.ts`)

```typescript
/** Upstream LLM rate limit exceeded. */
export const RATE_LIMITED = -32029;
```

### 5. Mobile error message mapping (`apps/mobile/lib/services/livekit_service.dart`)

Add to `_relayErrorMessage()` (~line 1555):

```dart
-32029 => 'Rate limited — try again shortly',
```

## Files to modify

- `apps/relay/src/index.ts` — add process error handlers
- `packages/acp-client/src/client.ts` — `AcpError` class, preserve error fields
- `apps/relay/src/bridge/relay-bridge.ts` — rate-limit detection, forward original codes
- `apps/relay/src/rpc/errors.ts` — add `RATE_LIMITED` constant
- `apps/mobile/lib/services/livekit_service.dart` — add rate-limit error message

## Testing

- Unit test `AcpError` construction and field preservation
- Unit test rate-limit pattern detection in relay bridge
- Verify existing relay tests still pass (`bun test` in `apps/relay`)

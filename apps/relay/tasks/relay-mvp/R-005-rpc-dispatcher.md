# R-005: RPC Method Dispatcher (Route `session/*` Methods)

**Depends On:** R-003, R-004  
**Blocks:** R-008  
**Effort:** 2 hours  

## Objective
Route incoming JSON-RPC requests to appropriate method handlers.

## Reference
See `docs/data-channel-protocol.md` sections:
- "Client → Relay Methods" — All method definitions

## Methods to Route
- `session/new` → `src/rpc/methods/session-new.ts`
- `session/message` → `src/rpc/methods/session-message.ts`
- `session/resume` → `src/rpc/methods/session-resume.ts`
- `session/cancel` → `src/rpc/methods/session-cancel.ts`
- `session/list` → `src/rpc/methods/session-list.ts`

## Key File
- `src/rpc/dispatcher.ts` — Route method name → handler function

## Acceptance Criteria
✅ Dispatcher maps method name to handler  
✅ Unknown method returns error `-32601` (Method not found)  
✅ Handler receives `params` object  
✅ Handler returns `result` or throws error  
✅ Dispatcher serializes response and sends via DataChannelTransport  

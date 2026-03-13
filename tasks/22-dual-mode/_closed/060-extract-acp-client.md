# Task 060: Extract Shared ACP Client Package

**Epic:** 22 — Dual-Mode Architecture
**Status:** [x]
**Depends on:** none
**Blocks:** 061 (AcpLLM Backend)

## Goal

Extract the ACP client from `apps/relay/src/acp/` into a shared `packages/acp-client` package so both the relay and ganglia (voice agent) can depend on the same ACP client implementation. This eliminates code duplication and ensures protocol handling stays consistent across both consumers.

## Context

The relay already has a production-tested ACP client (`apps/relay/src/acp/client.ts`, ~400 lines) with JSON-RPC 2.0 transport over stdio, subprocess lifecycle management, and session methods. The ganglia package needs the same client for the new `AcpLLM` backend (task 061).

Rather than duplicating, we extract it into `packages/acp-client` as a shared workspace dependency. Both relay and ganglia import from it.

The shared package also includes the JSON-RPC types currently in `apps/relay/src/rpc/types.ts` (requests, responses, notifications, helpers).

**Enhancement needed:** The relay client's `onUpdate()` method pushes handlers into an array but has no way to remove them. The ganglia consumer needs per-stream update listening with cleanup (subscribe for one `chat()` call, then unsubscribe). Add an `unsubscribe` return value.

```
BEFORE                                   AFTER
──────                                   ─────
apps/relay/src/acp/client.ts             packages/acp-client/src/client.ts
apps/relay/src/acp/types.ts              packages/acp-client/src/types.ts
apps/relay/src/rpc/types.ts              packages/acp-client/src/rpc.ts
apps/relay/test/mock-acpx.ts             packages/acp-client/test/mock-acpx.ts
apps/relay/src/acp/client.spec.ts        packages/acp-client/src/client.spec.ts
                                         packages/acp-client/src/index.ts (exports)
                                         packages/acp-client/package.json

apps/relay imports from                  apps/relay imports from
  ./acp/client                             @fletcher/acp-client
  ./rpc/types                              @fletcher/acp-client/rpc
```

## Implementation

### 1. Create package structure (`packages/acp-client/`)

Create `packages/acp-client/package.json`:
```json
{
  "name": "@fletcher/acp-client",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

### 2. Move source files

- Copy `apps/relay/src/acp/client.ts` → `packages/acp-client/src/client.ts`
- Copy `apps/relay/src/acp/types.ts` → `packages/acp-client/src/types.ts`
- Copy `apps/relay/src/rpc/types.ts` → `packages/acp-client/src/rpc.ts`
- Create `packages/acp-client/src/index.ts` — re-exports all public API

### 3. Add unsubscribe support

Change `onUpdate()` to return an unsubscribe function:

```typescript
onUpdate(handler: UpdateHandler): () => void {
  this.updateHandlers.push(handler);
  return () => {
    const idx = this.updateHandlers.indexOf(handler);
    if (idx >= 0) this.updateHandlers.splice(idx, 1);
  };
}
```

Same pattern for `onExit()`.

### 4. Decouple Logger type

The relay client uses `import type { Logger } from "../utils/logger"` which is relay-specific (pino). The shared package should accept any console-compatible logger interface:

```typescript
interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
}
```

### 5. Update relay imports (`apps/relay/`)

- Update `apps/relay/src/bridge/relay-bridge.ts` to import from `@fletcher/acp-client`
- Update `apps/relay/src/bridge/bridge-manager.ts` to import from `@fletcher/acp-client`
- Update any other files importing from `./acp/client` or `./rpc/types`
- Delete original files: `apps/relay/src/acp/client.ts`, `apps/relay/src/acp/types.ts`
- Keep `apps/relay/src/rpc/types.ts` if it has relay-specific helpers, otherwise delete
- Add `"@fletcher/acp-client": "workspace:*"` to `apps/relay/package.json`

### 6. Migrate tests

- Move `apps/relay/src/acp/client.spec.ts` → `packages/acp-client/src/client.spec.ts`
- Move `apps/relay/test/mock-acpx.ts` → `packages/acp-client/test/mock-acpx.ts`
- Add test for unsubscribe behavior
- Verify all existing tests pass with `bun test` in the new package

### 7. Register in workspace

Add `packages/acp-client` to the root `package.json` workspaces array (or `pnpm-workspace.yaml` if using pnpm).

## Not in scope

- WebSocket transport — stdio only for now (defer to future task)
- Request timeout — handled by consumers, not the client
- Notification handler for methods other than `session/update` — ganglia can extend locally

## Relates to

- `apps/relay/src/acp/client.ts` — source of truth being extracted
- Task 061 (AcpLLM Backend) — primary consumer of the shared package
- `apps/relay/docs/acp-transport.md` — ACP protocol spec

## Acceptance criteria

- [ ] `packages/acp-client` exists with `client.ts`, `types.ts`, `rpc.ts`, `index.ts`
- [ ] `AcpClient.onUpdate()` returns an unsubscribe function
- [ ] `AcpClient.onExit()` returns an unsubscribe function
- [ ] Logger interface is generic (not pino-specific)
- [ ] All migrated tests pass (`bun test` in `packages/acp-client/`)
- [ ] New test: unsubscribe from update handler
- [ ] Relay imports updated — `bun test` passes in `apps/relay/`
- [ ] Original files deleted from relay
- [ ] Package registered in workspace root

# R-001: Scaffold Relay Project (Bun + TypeScript + Dependencies)

**Epic:** Fletcher Relay MVP  
**Status:** 📋 Ready for Implementation  
**Blocks:** R-002, R-003, R-004, R-005  
**Effort:** 30 min  

---

## Objective

Initialize the `fletcher-relay` repository with Bun runtime, TypeScript configuration, and core dependencies.

---

## Acceptance Criteria

✅ `package.json` with required dependencies  
✅ `tsconfig.json` with strict TypeScript config  
✅ `.gitignore` for `node_modules`, `dist`, `.env`  
✅ Basic project structure (`src/`, `test/`, `docs/`)  
✅ `bun run dev` starts a placeholder HTTP server  
✅ `bun test` runs placeholder test suite  

---

## Dependencies

### Runtime
- **Bun:** Latest stable (≥1.0.0) — Runtime + bundler + test runner

### Core Dependencies
```json
{
  "dependencies": {
    "@livekit/rtc-node": "^0.10.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/bun": "latest",
    "bun-types": "latest"
  }
}
```

**Why these?**
- `@livekit/rtc-node` — LiveKit participant SDK for joining rooms, data channels
- `zod` — Runtime schema validation for JSON-RPC requests/responses
- TypeScript — Type safety for session management and protocol handling

---

## Project Structure

```
fletcher-relay/
├── src/
│   ├── index.ts              # Entry point (HTTP server + LiveKit participant manager)
│   ├── livekit/              # LiveKit participant logic (R-002)
│   │   └── participant.ts
│   ├── data-channel/         # Data channel transport (R-003)
│   │   └── transport.ts
│   ├── jsonrpc/              # JSON-RPC 2.0 protocol (R-004)
│   │   ├── parser.ts
│   │   ├── serializer.ts
│   │   └── errors.ts
│   ├── rpc/                  # RPC method routing (R-005)
│   │   ├── dispatcher.ts
│   │   └── methods/
│   │       ├── session-new.ts
│   │       ├── session-message.ts
│   │       ├── session-resume.ts
│   │       ├── session-cancel.ts
│   │       └── session-list.ts
│   ├── openclaw/             # OpenClaw HTTP client (R-006)
│   │   └── client.ts
│   ├── session/              # Session management (R-007, R-008)
│   │   ├── types.ts
│   │   ├── manager.ts
│   │   └── persistence.ts   # SQLite storage (R-010)
│   ├── http/                 # HTTP server (R-013)
│   │   ├── server.ts
│   │   └── routes/
│   │       ├── health.ts
│   │       └── join.ts      # Token server signal endpoint (R-012)
│   └── utils/
│       ├── logger.ts
│       └── env.ts           # Environment config loader
├── test/
│   └── jsonrpc.test.ts      # Placeholder test
├── docs/
│   ├── architecture.md      # (Already exists)
│   ├── gateway-api-contract.md
│   ├── data-channel-protocol.md
│   └── room-metadata-schema.md
├── tasks/
│   └── relay-mvp/           # This directory
│       ├── R-001-scaffold-relay-project.md
│       └── ...
├── .env.example             # Example environment config
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

## TypeScript Configuration

**`tsconfig.json`:**
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "lib": ["ESNext"],
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["bun-types"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

**Why bundler module resolution:**
- Bun uses modern ESM bundling (no CJS interop needed)
- Allows `import.meta` and top-level await

---

## Environment Configuration

**`.env.example`:**
```bash
# LiveKit Configuration
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret

# OpenClaw Gateway
OPENCLAW_GATEWAY_URL=http://localhost:18791
OPENCLAW_API_KEY=

# Relay Configuration
RELAY_BACKEND=openclaw  # or "claude" for Agent SDK
RELAY_HTTP_PORT=7890
RELAY_IDLE_TIMEOUT_MS=300000  # 5 minutes
RELAY_SESSION_BUFFER_TIMEOUT_MS=1800000  # 30 minutes

# Logging
LOG_LEVEL=info
```

**Environment Loader (`src/utils/env.ts`):**
```typescript
import { z } from 'zod';

const envSchema = z.object({
  LIVEKIT_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  OPENCLAW_GATEWAY_URL: z.string().url().default('http://localhost:18791'),
  OPENCLAW_API_KEY: z.string().optional(),
  RELAY_BACKEND: z.enum(['openclaw', 'claude']).default('openclaw'),
  RELAY_HTTP_PORT: z.coerce.number().int().positive().default(7890),
  RELAY_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),
  RELAY_SESSION_BUFFER_TIMEOUT_MS: z.coerce.number().int().positive().default(1800000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const env = envSchema.parse(process.env);
```

---

## Entry Point (Placeholder)

**`src/index.ts`:**
```typescript
#!/usr/bin/env bun

import { env } from './utils/env';

console.log(`🚀 Fletcher Relay starting...`);
console.log(`📡 LiveKit URL: ${env.LIVEKIT_URL}`);
console.log(`🤖 Backend: ${env.RELAY_BACKEND}`);
console.log(`🔌 HTTP Port: ${env.RELAY_HTTP_PORT}`);

// Placeholder HTTP server (Task R-013 will expand this)
Bun.serve({
  port: env.RELAY_HTTP_PORT,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not Found', { status: 404 });
  },
});

console.log(`✅ HTTP server running on http://localhost:${env.RELAY_HTTP_PORT}`);
console.log(`💡 Try: curl http://localhost:${env.RELAY_HTTP_PORT}/health`);
```

---

## Placeholder Test

**`test/jsonrpc.test.ts`:**
```typescript
import { test, expect } from 'bun:test';

test('JSON-RPC 2.0 placeholder', () => {
  const message = { jsonrpc: '2.0', method: 'test', id: 1 };
  expect(message.jsonrpc).toBe('2.0');
});
```

---

## .gitignore

```gitignore
# Dependencies
node_modules/
bun.lockb

# Build output
dist/
*.log

# Environment
.env
.env.local

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db

# SQLite
*.db
*.db-shm
*.db-wal
```

---

## Installation & Verification

**Steps:**

1. **Install Bun** (if not already installed):
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. **Initialize project:**
   ```bash
   cd apps/relay
   bun install
   ```

3. **Create `.env` file:**
   ```bash
   cp .env.example .env
   # Edit .env with your LiveKit credentials
   ```

4. **Run dev server:**
   ```bash
   bun run dev
   ```

5. **Test health endpoint:**
   ```bash
   curl http://localhost:7890/health
   # Expected: {"status":"ok"}
   ```

6. **Run tests:**
   ```bash
   bun test
   # Expected: 1 passed
   ```

---

## package.json Scripts

**`package.json`:**
```json
{
  "name": "fletcher-relay",
  "version": "0.1.0",
  "description": "Fletcher Chat Mode Relay (LiveKit non-agent participant + OpenClaw)",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@livekit/rtc-node": "^0.10.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "bun-types": "latest",
    "typescript": "^5.3.0"
  }
}
```

---

## Success Criteria

- [ ] `bun install` completes without errors
- [ ] `bun run dev` starts HTTP server on port 7890
- [ ] `curl http://localhost:7890/health` returns `{"status":"ok"}`
- [ ] `bun test` runs and passes placeholder test
- [ ] `bun run typecheck` passes with no TypeScript errors
- [ ] `.env` file exists with LiveKit credentials
- [ ] Project structure matches layout above

---

## Next Steps

Once this task is complete:
- **R-002:** Implement LiveKit participant manager (join/leave rooms)
- **R-003:** Implement data channel transport (subscribe to `relay` topic)
- **R-004:** Implement JSON-RPC 2.0 parser/serializer

---

**Status:** Ready for implementation. No blocking dependencies.

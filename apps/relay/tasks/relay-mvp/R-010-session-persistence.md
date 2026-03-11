# R-010: Session Persistence (SQLite Storage)

**Depends On:** R-007, R-008  
**Blocks:** None  
**Effort:** 2 hours  

## Objective
Persist session state to SQLite for reconnection support.

## Reference
See `docs/gateway-api-contract.md` section "Session Persistence Schema"

## Schema
```sql
CREATE TABLE sessions (
  sessionId TEXT PRIMARY KEY,
  sessionKey TEXT NOT NULL,
  openclawSessionId TEXT,
  roomName TEXT NOT NULL,
  userId TEXT,
  state TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  lastActivity INTEGER NOT NULL,
  messages TEXT NOT NULL  -- JSON array
);

CREATE INDEX idx_sessionKey ON sessions(sessionKey);
CREATE INDEX idx_roomName ON sessions(roomName);
CREATE INDEX idx_lastActivity ON sessions(lastActivity);
```

## Key File
- `src/session/persistence.ts`

## Features
- `saveSession(session: Session)` → INSERT or UPDATE
- `loadSession(sessionId: string)` → Session | null
- `deleteSession(sessionId: string)` → void
- `cleanupOldSessions(olderThanMs: number)` → delete idle sessions

## Acceptance Criteria
✅ Sessions persisted to SQLite  
✅ `session/resume` loads from DB  
✅ Old sessions (>24h) cleaned up  

# R-008: Session Manager (Lifecycle: Create/Resume/Cancel)

**Depends On:** R-006, R-007  
**Blocks:** R-009, R-010  
**Effort:** 3 hours  

## Objective
Implement session lifecycle management (create, resume, message, cancel, list).

## Reference
See `docs/data-channel-protocol.md` sections:
- "Client → Relay Methods" — All `session/*` method behaviors

## Key File
- `src/session/manager.ts`

## Features
- **Create:** Generate sessionId (UUID), map to OpenClaw session key
- **Resume:** Load session from persistence, return buffered events
- **Message:** Append to history, call OpenClaw client
- **Cancel:** Abort in-flight requests
- **List:** Return all active sessions

## Acceptance Criteria
✅ `createSession(prompt)` → new Session with UUID  
✅ `resumeSession(sessionId)` → loaded Session or error  
✅ `sendMessage(sessionId, content)` → append to history, call OpenClaw  
✅ `cancelSession(sessionId)` → abort OpenClaw request  
✅ `listSessions()` → array of active sessions  
✅ Session key routing: guest_* or room_* derived from LiveKit metadata  

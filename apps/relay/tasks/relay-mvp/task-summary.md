# Fletcher Relay MVP — Task Summary

**Epic:** Fletcher Relay (Chat Mode Backend)  
**Status:** 📋 Specs Complete, Ready for Implementation  
**Date:** 2026-03-10  

---

## Overview

The Fletcher Relay is a Bun-based server that acts as a LiveKit non-agent participant, providing chat mode functionality by proxying JSON-RPC 2.0 requests from the mobile client to the OpenClaw Gateway.

**Key specs:**
- `docs/gateway-api-contract.md` — OpenClaw HTTP API integration
- `docs/data-channel-protocol.md` — JSON-RPC 2.0 over LiveKit data channel
- `docs/room-metadata-schema.md` — Voice/Chat mode coordination

---

## Task List (R-001 through R-014)

### ✅ Phase 1: Foundation & Transport

| Task | Title | Effort | Status |
|------|-------|--------|--------|
| **R-001** | Scaffold Relay Project (Bun + TypeScript + Deps) | 30 min | 📋 Spec ready |
| **R-002** | LiveKit Participant Manager (Join/Leave Rooms) | 2 hours | 📋 Spec ready |
| **R-003** | Data Channel Transport (Subscribe to `relay` Topic) | 2 hours | 📋 Spec ready |
| **R-004** | JSON-RPC 2.0 Protocol (Parser/Serializer/Errors) | 2 hours | 📋 Spec ready |
| **R-005** | RPC Method Dispatcher (Route `session/*` Methods) | 2 hours | 📋 Spec ready |

**Acceptance:** Relay can join LiveKit room, receive JSON-RPC requests, echo responses.

---

### ✅ Phase 2: OpenClaw Integration

| Task | Title | Effort | Status |
|------|-------|--------|--------|
| **R-006** | OpenClaw HTTP Client (Streaming SSE Support) | 3 hours | 📋 Spec ready |
| **R-007** | Session Types (TypeScript Schemas for State) | 1 hour | 📋 Spec ready |
| **R-008** | Session Manager (Lifecycle: Create/Resume/Cancel) | 3 hours | 📋 Spec ready |
| **R-009** | Message Streaming (SSE → JSON-RPC Notifications) | 2 hours | 📋 Spec ready |
| **R-010** | Session Persistence (SQLite Storage) | 2 hours | 📋 Spec ready |

**Acceptance:** Relay proxies chat requests to OpenClaw, streams responses to mobile client.

---

### ✅ Phase 3: Lifecycle & Health

| Task | Title | Effort | Status |
|------|-------|--------|--------|
| **R-011** | Idle Timeout (Disconnect After 5 Min Inactivity) | 2 hours | 📋 Spec ready |
| **R-012** | Token Server Signal (HTTP `/relay/join` Endpoint) | 1 hour | 📋 Spec ready |
| **R-013** | Health Endpoints (`/health`, `/sessions` for Debug) | 1 hour | 📋 Spec ready |
| **R-014** | Error Recovery (Retry Logic, Graceful Degradation) | 2 hours | 📋 Spec ready |

**Acceptance:** Relay is production-ready with auto-disconnect, health monitoring, error handling.

---

## Total Effort Estimate

**Phase 1:** ~9 hours  
**Phase 2:** ~11 hours  
**Phase 3:** ~6 hours  

**Total:** ~26 hours (~3-4 days for a single developer)

---

## Implementation Order

1. **R-001** → **R-002** → **R-003** → **R-004** → **R-005** (Foundation)
2. **R-006** → **R-007** → **R-008** → **R-009** → **R-010** (OpenClaw integration)
3. **R-011** → **R-012** → **R-013** → **R-014** (Production readiness)

**Parallel work possible:**
- R-007 (types) can be done alongside R-006 (HTTP client)
- R-012 (token server signal) can be done alongside R-011 (idle timeout)

---

## Blockers Resolved

All 6 critical gaps identified in `blocking-gaps.md` have been resolved with spec documents:

✅ **Gap 1:** OpenClaw API contract → `gateway-api-contract.md`  
✅ **Gap 2:** Data channel protocol → `data-channel-protocol.md`  
✅ **Gap 3:** Token server signal → Covered in R-012 spec  
✅ **Gap 4:** Room metadata → `room-metadata-schema.md`  
✅ **Gap 5:** Session persistence → Covered in R-010 spec  
✅ **Gap 6:** Error recovery → Covered in R-014 spec  

---

## Dependencies

**External:**
- OpenClaw Gateway (running locally at `http://localhost:18791`)
- LiveKit Server (running locally or cloud, e.g., `ws://localhost:7880`)
- Token Server (existing, needs update for `/relay/join` signal — R-012)

**Internal:**
- Tasks R-001 through R-014 are sequenced with clear dependencies
- No circular dependencies
- Each task has isolated acceptance criteria

---

## Next Steps

1. **Andre/Glitch:** Review this task summary and the 3 spec docs
2. **Coding Agent (Claude Code):** Begin implementation starting with R-001
3. **Static (this agent):** Monitor progress, answer clarifying questions, update task statuses

---

## Success Criteria (Relay MVP Complete)

- [ ] All tasks R-001 through R-014 implemented and tested
- [ ] Relay can join LiveKit room on demand (token server signal)
- [ ] Relay handles `session/new`, `session/message`, `session/resume`, `session/cancel`, `session/list` JSON-RPC methods
- [ ] Relay proxies requests to OpenClaw Gateway via `/v1/chat/completions`
- [ ] Relay streams OpenClaw SSE responses as `session/update` JSON-RPC notifications
- [ ] Relay persists session state in SQLite
- [ ] Relay auto-disconnects after 5 min idle per room
- [ ] Relay exposes `/health` and `/sessions` HTTP endpoints
- [ ] Relay handles errors gracefully (retry logic, client error notifications)
- [ ] Integration tests pass (relay ↔ mobile client ↔ OpenClaw)

**Once complete:** Epic 22 (Fletcher dual-mode) can proceed with Flutter integration (tasks 042-051).

---

**Status:** All specs drafted. Ready for implementation.

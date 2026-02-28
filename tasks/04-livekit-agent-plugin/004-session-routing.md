# Task: Session Key Routing (spec 08)

## Status: Complete ✅

Implements the session-continuity spec (`docs/specs/08-session-continuity/`) to replace room-scoped session IDs with identity-based routing. This enables conversation persistence across LiveKit room reconnections.

---

## Phase 1: Session Key Resolution ✅

### 1.1 `resolveSessionKey()` in ganglia
- [x] Define `SessionKey` type: `{ type: 'owner' | 'guest' | 'room'; key: string }`
- [x] Define `SpeakerVerification` type: `'owner' | 'guest' | 'unknown'`
- [x] Define `SessionRoutingConfig`: `{ ownerIdentity?: string }`
- [x] Implement `resolveSessionKey(participantCount, participantIdentity, roomName, speakerVerified)`
- [x] Implement `resolveSessionKeySimple(participantIdentity, ownerIdentity, roomName?, participantCount?)` — simplified version using identity match as fallback
- [x] Unit tests for all routing scenarios (16 tests)
- [x] Export from `src/index.ts`

### 1.2 `FLETCHER_OWNER_IDENTITY` env var support
- [x] Voice agent reads `FLETCHER_OWNER_IDENTITY` from env
- [x] Fallback behavior: if not set, all participants treated as guests (safe default)

---

## Phase 2: Update OpenClawClient ✅

### 2.1 Session header/body format
- [x] Owner sessions: send `x-openclaw-session-key: main` header (no `user` field)
- [x] Guest sessions: send `user: "guest_{identity}"` in request body (no session-key header)
- [x] Room sessions: send `user: "room_{roomName}"` in request body (no session-key header)
- [x] Keep existing `X-OpenClaw-*` metadata headers as supplementary (via `buildMetadataHeaders()`)
- [x] `applySessionKey()` helper function for clean header/body separation
- [x] Legacy fallback: old `buildSessionHeaders()` still works when no `SessionKey` provided

### 2.2 `OpenClawLLM` accepts `SessionKey`
- [x] `setSessionKey(key)` stores on the LLM instance
- [x] `chat()` passes `sessionKey` through `OpenClawChatStream` to client

### 2.3 Unit tests (11 new tests)
- [x] Header output for owner routing
- [x] Body output for guest routing
- [x] Body output for room routing
- [x] Metadata headers still sent alongside SessionKey
- [x] SessionKey takes priority over legacy session
- [x] Legacy fallback when no SessionKey

---

## Phase 3: Update NanoclawClient ✅

### 3.1 Channel header format
- [x] Owner sessions: `X-Nanoclaw-Channel: main`
- [x] Guest sessions: `X-Nanoclaw-Channel: guest:{identity}`
- [x] Room sessions: `X-Nanoclaw-Channel: room:{roomName}`
- [x] `sessionKeyToChannel()` helper function
- [x] Legacy JID fallback when no SessionKey

### 3.2 `NanoclawLLM` accepts `SessionKey`
- [x] `setSessionKey(key)` stores on the LLM instance
- [x] `chat()` passes `sessionKey` through `NanoclawChatStream` to client

### 3.3 Unit tests (8 new tests)
- [x] Channel header for each routing type
- [x] SessionKey takes priority over legacy JID
- [x] Legacy fallback

---

## Phase 4: Voice Agent Wiring ✅

- [x] Import `resolveSessionKeySimple` from ganglia
- [x] Read `FLETCHER_OWNER_IDENTITY` from env
- [x] Resolve session key after `waitForParticipant()`
- [x] Pass `sessionKey` to ganglia LLM via `setSessionKey()`
- [x] Log resolved session routing type on connect
- [x] Update env var documentation in agent header

---

## Phase 5: Deprecation

- [x] Mark `generateSessionId()` as `@deprecated`
- [x] Mark `buildSessionHeaders()` as `@deprecated`
- [ ] Package README documentation (deferred to task 001 phase 5)

---

## Test Summary

- 16 session routing tests (new)
- 11 OpenClawClient session key tests (new)
- 8 NanoclawClient session key tests (new)
- 162 total tests passing (35 new + 127 existing, 2 pre-existing failures from LiveKit logger init)

---

**Spec:** [`docs/specs/08-session-continuity/`](../../docs/specs/08-session-continuity/spec.md)

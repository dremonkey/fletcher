# Task: Session Key Routing (spec 08)

## Status: Not Started

Implements the session-continuity spec (`docs/specs/08-session-continuity/`) to replace room-scoped session IDs with identity-based routing. This is the critical fix that enables conversation persistence across LiveKit room reconnections.

**Problem:** The current `generateSessionId()` produces `roomSid:participantIdentity`, which is tied to the ephemeral room. Every reconnect creates a new room SID, so the backend sees a brand-new session and conversation history is lost.

**Solution:** Route sessions based on **who is speaking** (owner vs guest vs multi-user), not **which room they're in**.

---

## Phase 1: Session Key Resolution

### 1.1 Add `resolveSessionKey()` to ganglia

Create `src/session-routing.ts` with the core routing logic from the spec:

- [ ] Define `SessionKey` type: `{ type: 'owner' | 'guest' | 'room'; key: string }`
- [ ] Define `SessionRoutingConfig`: `{ ownerIdentity?: string }`
- [ ] Implement `resolveSessionKey(participants, speakerVerified, config)`:
  - Solo + owner verified → `{ type: 'owner', key: 'main' }`
  - Solo + not owner → `{ type: 'guest', key: 'guest:{identity}' }`
  - Multi-user → `{ type: 'room', key: 'room:{roomName}' }`
- [ ] Implement `resolveSessionKeySimple(participantIdentity, ownerIdentity)` — simplified version for the common single-participant case (no voice fingerprinting yet, uses identity match as the fallback)
- [ ] Unit tests for all routing scenarios
- [ ] Export from `src/index.ts`

### 1.2 Add `FLETCHER_OWNER_IDENTITY` env var support

- [ ] Read `FLETCHER_OWNER_IDENTITY` in `createGangliaFromEnv()` and pass through config
- [ ] Add `ownerIdentity` to `GangliaConfig` (both `OpenClawConfig` and `NanoclawConfig`)
- [ ] Fallback behavior: if not set, all participants are treated as guests (safe default)

---

## Phase 2: Update OpenClawClient

Align HTTP requests with the OpenClaw implementation spec (`docs/specs/08-session-continuity/openclaw-implementation.md`).

### 2.1 Change session header/body format

- [ ] Owner sessions: send `x-openclaw-session-key: main` header (no `user` field)
- [ ] Guest sessions: send `user: "guest_{identity}"` in request body (no session-key header)
- [ ] Room sessions: send `user: "room_{roomName}"` in request body (no session-key header)
- [ ] Keep existing `X-OpenClaw-*` metadata headers (Room-SID, Room-Name, Participant-Identity, Participant-SID) as supplementary — they don't affect routing but aid debugging
- [ ] Remove or deprecate `X-OpenClaw-Session-Id` header (replaced by the new routing)
- [ ] Remove `session_id` from request body (replaced by `user` field)

### 2.2 Update `OpenClawLLM` to accept a `SessionKey`

- [ ] Add `sessionKey?: SessionKey` to chat options (alongside existing `session` for metadata)
- [ ] `OpenClawChatStream.run()` passes `SessionKey` to client
- [ ] Update `extractSessionFromContext()` or add a new method that produces both `SessionKey` and metadata `LiveKitSessionInfo`

### 2.3 Unit tests

- [ ] Test header output for owner routing
- [ ] Test body output for guest routing
- [ ] Test body output for room routing
- [ ] Test backward compat: metadata headers still sent
- [ ] Test missing owner identity → defaults to guest

---

## Phase 3: Update NanoclawClient

Align with the Nanoclaw implementation spec (`docs/specs/08-session-continuity/nanoclaw-implementation.md`).

### 3.1 Change channel header format

- [ ] Owner sessions: send `X-Nanoclaw-Channel: main` (or omit header for default session)
- [ ] Guest sessions: send `X-Nanoclaw-Channel: guest:{identity}`
- [ ] Room sessions: send `X-Nanoclaw-Channel: room:{roomName}`
- [ ] Deprecate `NANOCLAW_CHANNEL_PREFIX` / JID-based channel naming (replaced by routing)

### 3.2 Update `NanoclawLLM` to accept a `SessionKey`

- [ ] Mirror the OpenClawLLM changes for consistency

### 3.3 Unit tests

- [ ] Test channel header for each routing type
- [ ] Test backward compat with legacy prefix mode

---

## Phase 4: Wire Session Routing in Voice Agent

Update `apps/voice-agent/src/agent.ts` to use the new routing.

- [ ] Import `resolveSessionKeySimple` from ganglia
- [ ] Read `FLETCHER_OWNER_IDENTITY` from env
- [ ] After `waitForParticipant()`, resolve the session key:
  ```typescript
  const sessionKey = resolveSessionKeySimple(participant.identity, process.env.FLETCHER_OWNER_IDENTITY);
  ```
- [ ] Pass `sessionKey` to ganglia LLM alongside the existing metadata session
- [ ] Add `FLETCHER_OWNER_IDENTITY` to env var documentation and validation
- [ ] Log the resolved session routing type on connect

---

## Phase 5: Deprecation & Cleanup

- [ ] Mark `generateSessionId()` as `@deprecated` (still used for managed session tracking internally)
- [ ] Mark `OpenClawChatOptions.sessionId` as `@deprecated` (already partially deprecated)
- [ ] Update `buildSessionHeaders()` to exclude `X-OpenClaw-Session-Id` from the default set
- [ ] Update ganglia README (when written) to document the new routing model

---

## Success Criteria

- [ ] Owner connects → requests go with `x-openclaw-session-key: main`
- [ ] Owner disconnects and reconnects to a **new room** → same session continues (no history loss)
- [ ] Guest connects → requests go with `user: "guest_{identity}"` in body
- [ ] Guest gets isolated session (no access to owner memory)
- [ ] All 129+ existing unit tests still pass
- [ ] New routing unit tests cover all scenarios from the spec

## Dependencies

- OpenClaw Gateway must honor `x-openclaw-session-key` header and `user` body field
- Voice fingerprinting (spec 06) is NOT required — the `FLETCHER_OWNER_IDENTITY` fallback is sufficient for now

---

**Spec:** [`docs/specs/08-session-continuity/`](../../docs/specs/08-session-continuity/spec.md)

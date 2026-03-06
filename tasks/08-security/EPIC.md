# Epic: Security & Privacy (08-security)

Lock down identity, secrets, and data isolation so Fletcher is safe for multi-user and shared-device scenarios — no leaked conversations, no hardcoded credentials, no ambiguous routing.

## Context

Fletcher currently runs in a trusted single-user dev environment: the LiveKit API secret is static and committed, every participant is routed as "guest_user," and there's no barrier preventing one user's conversation context from bleeding into another's session. Before any real deployment these gaps need to close. The tasks move from infrastructure hygiene (rotate the secret) through identity plumbing (tell the backend *who* is talking) to the harder privacy problem (prevent cross-user data leakage in shared rooms).

## Tasks

### Secrets & Credentials

- [ ] **001: Dynamic LiveKit Secret** — Generate a unique LiveKit API secret at setup time instead of shipping a hardcoded value in the repo.

### Identity Routing

- [ ] **002: Explicit Identity Routing** — Pass the real user identity to OpenClaw so sessions are attributed correctly, replacing the generic "guest_user" default.

### Multi-User Privacy

- [ ] **003: Multi-User Privacy Guard** — Implement context isolation so one user's private data never leaks to other participants in a shared room.

## Status Summary

| Area | Status |
|------|--------|
| Secrets & Credentials | Not started |
| Identity Routing | Not started |
| Multi-User Privacy | Not started |

## Dependencies

- **Epic 09 (Connectivity):** Identity routing (002) interacts with reconnection — the identity must survive reconnects.
- **OpenClaw Gateway:** Tasks 002 and 003 require API-side support for per-user context scoping.

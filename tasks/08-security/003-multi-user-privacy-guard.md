# Task: Multi-User Privacy Guard (Session Context Isolation)

## Status
- **Priority:** High
- **Status:** Proposed
- **Owner:** Andre
- **Created:** 2026-02-28

## Problem
Currently, Fletcher assumes a single-owner environment. If a second user (e.g., a family member) joins a LiveKit room and interacts with the agent, the agent may inadvertently use the owner's private memory (`MEMORY.md`, `USER.md`, etc.) to generate responses. This creates a privacy leak where personal data is shared with non-owner participants.

## Proposed Fix
Implement a "Context Isolation" layer in the Fletcher agent that scales based on the participant's identity.

1.  **Identity Mapping:** The LiveKit agent must map `Participant.identity` to an OpenClaw session key.
    - Owner (e.g., `Andre`) -> Full access (load `MEMORY.md`, `USER.md`).
    - Known Guest (e.g., `Dingus`) -> Restricted access (load `FAMILY_MEMORY.md`, skip `MEMORY.md`).
    - Unknown Guest -> Sandbox access (no private file access).

2.  **Restricted Mode Logic:**
    - Create a `RESTRICTED_MODE` flag in the agent's system prompt or configuration.
    - When active, the agent is programmatically blocked from calling tools that read from `~/code/` or the root `workspace/` memory files.
    - Use a separate `PUBLIC_SOUL.md` or a "Guest Persona" to define how the agent should behave with non-owners.

3.  **Cross-Participant Protection:** Ensure that the agent's internal state (recent context) is cleared or siloed when switching between participants in a shared room conversation to prevent "context carry-over" (where a guest asks a follow-up to a private owner thought).

## References
- Discussion in session `agent:main:main` on 2026-02-28 regarding "Privacy leaks in multi-user rooms".
- Epic 6: Voice Fingerprinting (Sovereign ID) for high-assurance identity verification.

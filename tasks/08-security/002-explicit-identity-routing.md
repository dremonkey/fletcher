# Task: Explicit Identity in Session Routing (Fletcher -> OpenClaw)

## Status
- **Priority:** Medium
- **Status:** Proposed
- **Owner:** Andre
- **Created:** 2026-02-28

## Problem
Currently, when Fletcher connects to OpenClaw via the OpenAI-compatible API, it does not explicitly provide a user identity. This causes OpenClaw's API plugin to default the session routing label to `guest_user-[timestamp]`.

While the agent (Fletcher) correctly identifies the user as "Andre" by reading local workspace files (`USER.md`), the **session-level metadata** in OpenClaw remains generic. This is technically a "routing anonymity" bug that could lead to confusion in logs or, in multi-user environments, a potential identity-leak risk if an API key were compromised.

## Proposed Fix
Fletcher should be updated to pass an explicit `user` parameter in its OpenAI client configuration.

1.  **Identify Configuration Point:** Locate where the OpenAI client is initialized in Fletcher (LiveKit agent or Flutter app).
2.  **Add User Header/Parameter:** Ensure the `user` field in the completion request (or the connection initialization) is set to `Andre` (or a configurable name from the environment).
3.  **Validate in OpenClaw:** After the change, verify that new sessions in OpenClaw appear as `agent:main:openai-user:Andre` instead of `guest_user`.

## References
- Discussion in session `agent:main:main` on 2026-02-28 regarding "guest_user" vs. "Andre".
- OpenClaw OpenAI Plugin documentation regarding session key generation.

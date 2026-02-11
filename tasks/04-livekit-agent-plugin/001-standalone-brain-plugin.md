# Task List: Standalone Brain Plugin (`@knittt/livekit-agent-openclaw`)

## Phase 1: Foundation ✅
- [x] Initialize TypeScript project in `packages/livekit-agent-openclaw`.
- [x] Define the `OpenClawLLM` class extending `livekit.agents.llm.LLM`.
- [x] Implement `OpenClawChatStream` for managing streaming responses.

## Phase 2: OpenClaw Integration ✅
- [x] Implement `OpenClawClient` to interface with the OpenClaw Gateway API.
- [x] Handle authentication and session management with the Gateway.
    - API key-based authentication with Bearer tokens
    - LiveKit session info extraction (`roomSid`, `participantIdentity`, etc.)
    - Managed sessions with state tracking (`active`, `reconnecting`, `expired`)
    - Custom error types: `AuthenticationError`, `SessionError`
- [x] Implement message mapping (LiveKit `ChatMessage` <-> OpenClaw `Message`).
    - Maps `ChatMessage`, `FunctionCall`, and tool responses
    - Bidirectional: LiveKit context → OpenClaw messages → LiveKit chunks

## Phase 3: Advanced Features
- [x] Implement tool-calling support:
    - [x] Map LiveKit `FunctionCall` to OpenClaw's tool execution flow.
    - [ ] Support asynchronous tool resolution.
- [ ] Implement context injection (passing LiveKit room metadata as OpenClaw context).
- [ ] Add support for "Plugin-in-a-Plugin" signaling (sending control messages between the Brain and Channel).

## Phase 4: Testing & Distribution
- [x] Create unit tests for message mapping.
    - `llm.spec.ts`: OpenClawLLM, message mapping, session extraction
    - `client.spec.ts`: OpenClawClient, session management, authentication
- [ ] Test error handling and retries (network failures, rate limits).
- [ ] Create an integration test agent that uses the standalone plugin.
- [ ] Setup CI/CD for publishing the package to npm.

## Phase 5: Documentation
- [ ] Write README with usage examples.
- [ ] Document configuration options (env vars, programmatic).
- [ ] Add example agent using the plugin with LiveKit VoicePipelineAgent.

---

**Technical Spec:** [`docs/specs/04-livekit-agent-plugin/spec.md`](../../docs/specs/04-livekit-agent-plugin/spec.md)

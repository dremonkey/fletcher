# Task List: Standalone Brain Plugin (`@knittt/livekit-agent-openclaw`)

## Phase 1: Foundation
- [ ] Initialize TypeScript project in `packages/livekit-agent-openclaw`.
- [ ] Define the `OpenClawLLM` class extending `livekit.agents.llm.LLM`.
- [ ] Implement `OpenClawChat` for managing streaming responses.

## Phase 2: OpenClaw Integration
- [ ] Implement `OpenClawClient` to interface with the OpenClaw Gateway API.
- [ ] Handle authentication and session management with the Gateway.
- [ ] Implement message mapping (LiveKit `ChatMessage` <-> OpenClaw `Message`).

## Phase 3: Advanced Features
- [ ] Implement tool-calling support:
    - Map LiveKit `FunctionCall` to OpenClaw's tool execution flow.
    - Support asynchronous tool resolution.
- [ ] Implement context injection (passing LiveKit room metadata as OpenClaw context).
- [ ] Add support for "Plugin-in-a-Plugin" signaling (sending control messages between the Brain and Channel).

## Phase 4: Testing & Distribution
- [ ] Create unit tests for message mapping.
- [ ] Create an integration test agent that uses the standalone plugin.
- [ ] Setup CI/CD for publishing the package to npm.

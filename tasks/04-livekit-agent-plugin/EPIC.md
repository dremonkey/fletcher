# Epic: LiveKit Agent Plugin / Ganglia (04-livekit-agent-plugin)

Build and evolve the brain plugin that connects the LiveKit voice agent to OpenClaw's LLM backend — handling streaming chat, session routing, multi-backend support, and resilient request lifecycle management.

## Context

The agent plugin (Ganglia) is the bridge between LiveKit's voice pipeline and the OpenClaw inference backend. It wraps LLM communication behind a pluggable interface, manages streaming responses, handles session continuity across reconnections, and must gracefully recover from network failures and user interruptions. As the system has matured, the plugin has grown to support multiple backends (OpenClaw, Nanoclaw, OpenResponses) and sophisticated lane/turn management.

## Tasks

### Phase 1: Foundation ✅

- [x] **001: Standalone Brain Plugin** — Define and implement the `@knittt/livekit-agent-ganglia` package with `OpenClawLLM` class, streaming chat support, authentication, and message mapping.

### Phase 2: Multi-Backend & API Evolution

- [x] **002: Pluggable Brain Architecture & Nanoclaw Integration** — Refactor to support multiple backend LLMs (OpenClaw and Nanoclaw) with a unified configuration system and factory pattern.
- [ ] **003: OpenResponses API Backend** — Add an OpenResponses backend leveraging OpenClaw's item-based API for better voice streaming, file handling, and client-side tool execution.

### Phase 3: Session & Routing

- [ ] **004: Session Key Routing** — Implement session continuity across LiveKit room reconnections using identity-based routing that preserves conversation context.
- [ ] **005: End-to-End OpenClaw Integration** — Validate the complete voice pipeline from Flutter through LiveKit and Ganglia to a real OpenClaw Gateway instance.

### Phase 4: Resilience

- [x] **007: Handle "Queue is closed" Error** — Fix critical bug where user interruptions cause accumulated "Queue is closed" errors that permanently kill the agent session.
- [ ] **016: Explicit Turn Cancellation & Lane Management** — Implement robust cancellation of in-flight requests to prevent "Zombie Agent" states where network drops leave the OpenClaw session lane locked.

## Status Summary

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Foundation | ✅ Complete |
| 2 | Multi-Backend & API Evolution | Partially complete |
| 3 | Session & Routing | Not started |
| 4 | Resilience | Partially complete |

## Dependencies

- **Epic 02 (LiveKit Agent):** Consumes Ganglia as the LLM provider for the voice pipeline.
- **Epic 05 (Latency):** Ganglia HTTP timing directly impacts voice-to-voice latency.
- **Epic 10 (Metrics):** HTTP-layer timing instrumentation lives inside Ganglia.

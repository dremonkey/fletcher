# Epic: Metrics & Observability (10-metrics)

Instrument the voice pipeline with structured metrics, timing, and distributed tracing to diagnose latency bottlenecks and monitor system health in production.

## Context

Fletcher's voice pipeline spans multiple stages (STT → LLM → TTS) with latency targets under 1.5 seconds. Diagnosing where time is spent requires instrumentation at every layer — from LiveKit agent session events to HTTP-level timing inside Ganglia to full distributed traces via OpenTelemetry. This epic builds that observability stack incrementally.

## Tasks

### Phase 1: Event-Level Metrics ✅

- [x] **001: Wire Up AgentSession Metric Events** — Hook into `@livekit/agents` built-in `AgentSession` events to capture per-turn metrics (LLM TTFT, TTS TTFB, EOU delay, STT duration) via pino structured logging.

### Phase 2: HTTP-Layer Instrumentation

- [x] **002: HTTP-Layer Timing in Ganglia** — Add `performance.now()` timing inside Ganglia's `OpenClawClient.chat()` and `OpenClawChatStream.run()` to measure network round-trip, gateway processing, and SSE parsing latency.

### Phase 3: Distributed Tracing

- [ ] **003: OpenTelemetry Exporter Setup** — Wire up an OTLP trace exporter so spans go to Jaeger/Grafana with zero overhead when not configured, leveraging `@livekit/agents` built-in OTel infrastructure.

### Phase 4: Correlated Turn Metrics

- [ ] **004: Per-Turn Metrics Collector** — Create a `TurnMetricsCollector` that correlates per-`speechId` metrics (EOU, LLM, TTS) into a single per-turn latency summary with stale entry pruning.

## Status Summary

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Event-Level Metrics | ✅ Complete |
| 2 | HTTP-Layer Instrumentation | ✅ Complete |
| 3 | Distributed Tracing | Not started |
| 4 | Correlated Turn Metrics | Not started |

## Dependencies

- **Epic 02 (LiveKit Agent):** Metrics events originate from the agent session runtime.
- **Epic 04 (Agent Plugin):** HTTP-layer timing is instrumented inside Ganglia.
- **Epic 05 (Latency):** Metrics drive latency optimization decisions.

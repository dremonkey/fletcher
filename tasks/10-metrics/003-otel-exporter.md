# Task 002c: OpenTelemetry Exporter Setup

**Epic:** 10 - Metrics & Observability
**Parallel:** Yes — no dependencies on other tasks (but benefits from 001 being done first)

## Objective

Wire up a real OTLP trace exporter so spans go to Jaeger/Grafana/etc. Opt-in via `OTEL_EXPORTER_OTLP_ENDPOINT` env var — zero overhead when not set.

## Background

`@livekit/agents` already ships with full OTel infrastructure:
- `tracer` and `setTracerProvider` from `@livekit/agents/telemetry`
- Pre-defined span attributes (`ATTR_SPEECH_ID`, `ATTR_LLM_METRICS`, etc.)
- The SDK automatically creates spans for the voice pipeline when a TracerProvider is registered

The OTel SDK packages exist as transitive deps of `@livekit/agents` but need to be direct deps of voice-agent for configuration.

## Checklist

- [x] Add OTel dependencies to `apps/voice-agent/package.json`:
  - `@opentelemetry/api`
  - `@opentelemetry/sdk-trace-node` (or `sdk-trace-base` if Bun incompatible)
  - `@opentelemetry/exporter-trace-otlp-proto`
  - `@opentelemetry/resources`
  - `@opentelemetry/semantic-conventions`
- [x] Create `apps/voice-agent/src/telemetry.ts`:
  - `initTelemetry()` function that:
    - Reads `OTEL_EXPORTER_OTLP_ENDPOINT` from env
    - Returns `null` (no-op) if not set
    - Creates `NodeTracerProvider` with service name `fletcher-voice-agent`
    - Configures `OTLPTraceExporter` pointing to `${endpoint}/v1/traces`
    - Uses `SimpleSpanProcessor` for dev, `BatchSpanProcessor` for production
    - Calls `setTracerProvider()` from `@livekit/agents/telemetry`
    - Returns provider for shutdown
- [x] In `apps/voice-agent/src/agent.ts`:
  - Call `initTelemetry()` before `defineAgent()`
  - Add `otelProvider.shutdown()` to the existing shutdown callback
- [x] Add `OTEL_EXPORTER_OTLP_ENDPOINT` (commented out) to `docker-compose.yml` environment
- [x] Test with local Jaeger: `docker run -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one`
- [x] Verify traces appear in Jaeger UI with voice pipeline spans
- [x] Test that agent works normally WITHOUT the env var set (no OTel overhead)

## Risk: Bun Compatibility

`@opentelemetry/sdk-trace-node` uses Node's `async_hooks` for context propagation. If this fails under Bun:
- Fall back to `@opentelemetry/sdk-trace-base` with `ZoneContextManager` or manual context propagation
- The spans will still work, just without automatic parent-child nesting

## Files

- `apps/voice-agent/src/telemetry.ts` (new)
- `apps/voice-agent/src/agent.ts` — add init call + shutdown
- `apps/voice-agent/package.json` — add dependencies
- `docker-compose.yml` — add optional env var

## Success Criteria

1. With `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` and Jaeger running:
   - Traces visible in Jaeger UI under service `fletcher-voice-agent`
   - Voice pipeline spans show STT → LLM → TTS hierarchy
2. Without the env var: agent starts and runs exactly as before, no errors

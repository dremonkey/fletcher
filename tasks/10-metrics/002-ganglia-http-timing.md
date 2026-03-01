# Task 002b: HTTP-Layer Timing in Ganglia

**Epic:** 10 - Metrics & Observability
**Parallel:** Yes — no dependencies on other tasks in this epic

## Objective

Add `performance.now()` timing instrumentation inside Ganglia's `OpenClawClient.chat()` and `OpenClawChatStream.run()` to measure HTTP-layer latency that the SDK doesn't capture: fetch start → first SSE chunk → stream complete.

## Background

The SDK's `LLMMetrics.ttftMs` measures from when it calls `chat()` to the first `ChatChunk`. But it doesn't measure what happens *inside* the HTTP call — network round-trip, OpenClaw gateway processing, SSE parsing. These numbers are critical for diagnosing whether latency is in the network, the gateway, or the LLM backend.

## Checklist

- [x] In `packages/livekit-agent-ganglia/src/client.ts`, inside `chat()` generator method:
  - [x] Add `const fetchStartMs = performance.now()` before `fetch()` call (line 216)
  - [x] Track first successful `reader.read()` that yields data (line 274-287): `if (!firstChunkMs) firstChunkMs = performance.now()`
  - [x] After the while loop (line 293): `const streamCompleteMs = performance.now()`
  - [x] Log via `dbg.openclawClient('timing: fetch→firstChunk=%dms firstChunk→complete=%dms total=%dms', ...)`
- [x] In `packages/livekit-agent-ganglia/src/llm.ts`, inside `OpenClawChatStream.run()`:
  - [x] Add `const streamStartMs = performance.now()` before stream iteration (line 274)
  - [x] On `chunkCount === 1`: `firstChunkMs = performance.now()` + debug log
  - [x] After stream complete (line 318): log total stream timing
- [x] Run `bun test` in `packages/livekit-agent-ganglia/` to verify no regressions
- [x] Verify timing output appears with `DEBUG=ganglia:*`

## Files

- `packages/livekit-agent-ganglia/src/client.ts` — lines 207-299 (chat generator method)
- `packages/livekit-agent-ganglia/src/llm.ts` — lines 274-318 (OpenClawChatStream.run)

## Logging Standard

Uses `dbg.*` (debug library) per project convention — verbose trace output enabled with `DEBUG=ganglia:openclaw:client` and `DEBUG=ganglia:openclaw:stream`. NOT pino logger (this is trace-level, not production).

## Success Criteria

With `DEBUG=ganglia:*` enabled, logs show:
```
ganglia:openclaw:client timing: fetch→firstChunk=8012.3ms firstChunk→complete=4200.1ms total=12212.4ms
ganglia:openclaw:stream first chunk in 8015.1ms
ganglia:openclaw:stream stream complete: ttfc=8015.1ms total=12215.8ms chunks=47
```

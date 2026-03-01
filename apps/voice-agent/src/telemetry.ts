/**
 * Optional OpenTelemetry setup for the voice agent.
 *
 * Activates ONLY when OTEL_EXPORTER_OTLP_ENDPOINT is set. Otherwise no-ops
 * with zero overhead — no providers created, no spans emitted.
 *
 * When active, creates a NodeTracerProvider with an OTLP/proto exporter and
 * hands it to @livekit/agents via setTracerProvider(). The SDK then
 * automatically creates spans for the entire voice pipeline (STT, LLM, TTS,
 * agent turns).
 *
 * Usage:
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 bun run src/agent.ts dev
 */

import type { Logger } from 'pino';

let shutdownFn: (() => Promise<void>) | undefined;

/**
 * Initialize OTel tracing if OTEL_EXPORTER_OTLP_ENDPOINT is set.
 * Must be called before AgentSession.start().
 */
export async function initTelemetry(logger: Logger): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    logger.debug('OTEL_EXPORTER_OTLP_ENDPOINT not set — telemetry disabled');
    return;
  }

  // Dynamic imports — only pull in OTel when actually needed
  const { NodeTracerProvider, BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-node');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-proto');
  const { Resource } = await import('@opentelemetry/resources');
  const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = await import('@opentelemetry/semantic-conventions');
  const { telemetry } = await import('@livekit/agents');

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: 'fletcher-voice-agent',
    [ATTR_SERVICE_VERSION]: '1.0.0',
  });

  const exporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });

  const provider = new NodeTracerProvider({ resource });
  provider.addSpanProcessor(new BatchSpanProcessor(exporter));
  provider.register();

  // Hand the provider to the LiveKit SDK so it creates spans for the pipeline
  telemetry.setTracerProvider(provider);

  shutdownFn = async () => {
    await provider.shutdown();
  };

  logger.info({ endpoint }, 'OpenTelemetry tracing enabled');
}

/**
 * Flush and shut down the OTel provider. Call during agent shutdown.
 */
export async function shutdownTelemetry(): Promise<void> {
  if (shutdownFn) {
    await shutdownFn();
    shutdownFn = undefined;
  }
}

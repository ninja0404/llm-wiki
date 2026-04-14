import { logger } from './logger.js';

let sdk: { shutdown: () => Promise<void> } | null = null;

export async function initTracing(): Promise<void> {
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!otlpEndpoint) {
    logger.debug('OTEL_EXPORTER_OTLP_ENDPOINT not set, tracing disabled');
    return;
  }

  try {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    const { HttpInstrumentation } = await import('@opentelemetry/instrumentation-http');
    const resources = await import('@opentelemetry/resources');
    const semconv = await import('@opentelemetry/semantic-conventions');

    const Resource = resources.Resource || (resources as Record<string, unknown>).default?.Resource;
    const ATTR_SERVICE_NAME = semconv.ATTR_SERVICE_NAME || 'service.name';
    const ATTR_SERVICE_VERSION = semconv.ATTR_SERVICE_VERSION || 'service.version';

    const nodeSDK = new NodeSDK({
      resource: new Resource({
        [ATTR_SERVICE_NAME]: 'llm-wiki-api',
        [ATTR_SERVICE_VERSION]: '0.3.0',
      }),
      traceExporter: new OTLPTraceExporter({
        url: `${otlpEndpoint}/v1/traces`,
      }),
      instrumentations: [new HttpInstrumentation()],
    });

    nodeSDK.start();
    sdk = nodeSDK;
    logger.info({ endpoint: otlpEndpoint }, 'OpenTelemetry tracing initialized');
  } catch (err) {
    logger.warn({ err }, 'Failed to initialize OpenTelemetry tracing');
  }
}

export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    logger.info('OpenTelemetry tracing shutdown');
  }
}

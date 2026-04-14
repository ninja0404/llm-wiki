import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { config } from './config.js';
import { logger } from './logger.js';

let sdk: NodeSDK | null = null;

export function initTracing(): void {
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!otlpEndpoint) {
    logger.debug('OTEL_EXPORTER_OTLP_ENDPOINT not set, tracing disabled');
    return;
  }

  sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: 'llm-wiki-api',
      [ATTR_SERVICE_VERSION]: '0.3.0',
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${otlpEndpoint}/v1/traces`,
    }),
    instrumentations: [new HttpInstrumentation()],
  });

  sdk.start();
  logger.info({ endpoint: otlpEndpoint }, 'OpenTelemetry tracing initialized');
}

export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    logger.info('OpenTelemetry tracing shutdown');
  }
}

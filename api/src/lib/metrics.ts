import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const httpRequestTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});

export const llmInvocationDuration = new Histogram({
  name: 'llm_invocation_duration_seconds',
  help: 'LLM API call duration in seconds',
  labelNames: ['provider', 'model', 'step'],
  buckets: [0.5, 1, 2, 5, 10, 30, 60],
  registers: [registry],
});

export const llmTokensUsed = new Counter({
  name: 'llm_tokens_used_total',
  help: 'Total LLM tokens consumed',
  labelNames: ['provider', 'model', 'type'],
  registers: [registry],
});

export const ingestQueueDepth = new Gauge({
  name: 'ingest_queue_depth',
  help: 'Current depth of the ingest queue',
  registers: [registry],
});

export const activeWebsockets = new Gauge({
  name: 'active_websocket_connections',
  help: 'Current number of active WebSocket connections',
  registers: [registry],
});

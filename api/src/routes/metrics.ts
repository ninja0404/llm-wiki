import { Hono } from 'hono';
import { registry } from '../lib/metrics.js';

const app = new Hono();

app.get('/metrics', async (c) => {
  const metrics = await registry.metrics();
  c.header('Content-Type', registry.contentType);
  return c.body(metrics);
});

export default app;

import { Hono } from 'hono';
import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { sql } from 'drizzle-orm';

const app = new Hono();

const WORKER_HEARTBEAT_KEY = 'worker:heartbeat';
const WORKER_STALE_THRESHOLD_S = 60;

app.get('/health', async (c) => {
  const checks: Record<string, string> = {};

  try {
    await db.execute(sql`SELECT 1`);
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }

  try {
    await redis.ping();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'error';
  }

  try {
    const lastBeat = await redis.get(WORKER_HEARTBEAT_KEY);
    if (!lastBeat) {
      checks.worker = 'unknown';
    } else {
      const elapsed = (Date.now() - Number(lastBeat)) / 1000;
      checks.worker = elapsed < WORKER_STALE_THRESHOLD_S ? 'ok' : 'stale';
    }
  } catch {
    checks.worker = 'error';
  }

  const coreHealthy = checks.database === 'ok' && checks.redis === 'ok';

  return c.json(
    { status: coreHealthy ? 'healthy' : 'degraded', checks, uptime: process.uptime() },
    coreHealthy ? 200 : 503,
  );
});

export default app;

export { WORKER_HEARTBEAT_KEY };

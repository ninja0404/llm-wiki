import { Hono } from 'hono';
import { lintQueue } from '../jobs/queues.js';
import { db } from '../lib/db.js';
import { activityLogs } from '../db/schema/index.js';
import { eq, and, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const app = new Hono();

app.post('/', async (c) => {
  const workspaceId = c.req.param('workspaceId');
  const traceId = randomUUID();

  await lintQueue.add(
    'lint-workspace',
    { workspaceId, traceId },
    { jobId: `lint-${workspaceId}-${Date.now()}` },
  );

  return c.json({ queued: true, traceId });
});

app.get('/results', async (c) => {
  const workspaceId = c.req.param('workspaceId');
  const limit = Number(c.req.query('limit') || '10');

  const results = await db.query.activityLogs.findMany({
    where: and(
      eq(activityLogs.workspaceId, workspaceId),
      eq(activityLogs.action, 'lint_completed'),
    ),
    orderBy: [desc(activityLogs.createdAt)],
    limit: Math.min(limit, 50),
  });

  return c.json({ data: results });
});

export default app;

import { Hono } from 'hono';
import { db } from '../lib/db.js';
import { activityLogs } from '../db/schema/index.js';
import { eq, and, sql } from 'drizzle-orm';

const app = new Hono();

app.get('/', async (c) => {
  const workspaceId = c.req.param('workspaceId')!;
  const limit = Math.min(Number(c.req.query('limit') || 50), 100);
  const offset = Number(c.req.query('offset') || 0);
  const action = c.req.query('action');
  const entityType = c.req.query('entityType');

  const conditions = [eq(activityLogs.workspaceId, workspaceId)];
  if (action) conditions.push(eq(activityLogs.action, action));
  if (entityType) conditions.push(eq(activityLogs.entityType, entityType));

  const where = conditions.length === 1 ? conditions[0] : and(...conditions);

  const [logs, totalResult] = await Promise.all([
    db.query.activityLogs.findMany({
      where,
      orderBy: (a, { desc }) => [desc(a.createdAt)],
      limit,
      offset,
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(activityLogs)
      .where(where),
  ]);

  return c.json({
    data: logs,
    total: totalResult[0]?.count ?? 0,
    page: Math.floor(offset / limit) + 1,
    pageSize: limit,
  });
});

export default app;

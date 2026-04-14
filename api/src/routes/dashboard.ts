import { Hono } from 'hono';
import { db } from '../lib/db.js';
import { wikiPages, sources, conversations, activityLogs } from '../db/schema/index.js';
import { eq, and, isNull, sql } from 'drizzle-orm';

const app = new Hono();

app.get('/', async (c) => {
  const workspaceId = c.req.param('workspaceId')!;

  const [pageCount, sourceCount, conversationCount, flaggedCount, recentActivity] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(wikiPages)
      .where(and(eq(wikiPages.workspaceId, workspaceId), isNull(wikiPages.deletedAt)))
      .then((r) => r[0]?.count ?? 0),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(sources)
      .where(eq(sources.workspaceId, workspaceId))
      .then((r) => r[0]?.count ?? 0),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversations)
      .where(eq(conversations.workspaceId, workspaceId))
      .then((r) => r[0]?.count ?? 0),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(wikiPages)
      .where(and(eq(wikiPages.workspaceId, workspaceId), eq(wikiPages.status, 'flagged')))
      .then((r) => r[0]?.count ?? 0),

    db.query.activityLogs.findMany({
      where: eq(activityLogs.workspaceId, workspaceId),
      orderBy: (a, { desc }) => [desc(a.createdAt)],
      limit: 10,
    }),
  ]);

  return c.json({
    data: {
      stats: { pages: pageCount, sources: sourceCount, conversations: conversationCount, flagged: flaggedCount },
      recentActivity,
    },
  });
});

export default app;

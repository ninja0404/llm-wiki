import { Hono } from 'hono';
import { db } from '../lib/db.js';
import { wikiPages } from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';

const app = new Hono();

app.get('/', async (c) => {
  const workspaceId = c.req.param('workspaceId')!;
  const flagged = await db.query.wikiPages.findMany({
    where: and(eq(wikiPages.workspaceId, workspaceId), eq(wikiPages.status, 'flagged')),
    columns: { id: true, title: true, slug: true, summary: true, pageType: true, createdAt: true },
    orderBy: (w, { desc }) => [desc(w.createdAt)],
  });
  return c.json({ data: flagged });
});

app.post('/:pageId/resolve', async (c) => {
  const pageId = c.req.param('pageId')!;
  const body = await c.req.json<{ action: 'publish' | 'archive' | 'delete' }>();

  const page = await db.query.wikiPages.findFirst({
    where: and(eq(wikiPages.id, pageId), eq(wikiPages.status, 'flagged')),
  });
  if (!page) return c.json({ error: 'Not found or not flagged' }, 404);

  switch (body.action) {
    case 'publish':
      await db.update(wikiPages).set({ status: 'published', updatedAt: new Date() }).where(eq(wikiPages.id, pageId));
      break;
    case 'archive':
      await db.update(wikiPages).set({ status: 'archived', updatedAt: new Date() }).where(eq(wikiPages.id, pageId));
      break;
    case 'delete':
      await db.update(wikiPages).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(wikiPages.id, pageId));
      break;
  }

  return c.json({ data: { resolved: true } });
});

export default app;

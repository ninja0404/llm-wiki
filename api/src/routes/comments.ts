import { Hono } from 'hono';
import { db } from '../lib/db.js';
import { comments, editRequests, wikiPages, wikiPageVersions } from '../db/schema/index.js';
import { eq, and, desc, sql } from 'drizzle-orm';

const app = new Hono();

app.get('/pages/:pageId/comments', async (c) => {
  const pageId = c.req.param('pageId')!;

  const result = await db.query.comments.findMany({
    where: eq(comments.wikiPageId, pageId),
    orderBy: [desc(comments.createdAt)],
  });

  return c.json({ data: result });
});

app.post('/pages/:pageId/comments', async (c) => {
  const pageId = c.req.param('pageId')!;
  const userId = c.get('userId' as never) as string;
  const body = await c.req.json<{ content: string; mentions?: string[]; parentId?: string }>();

  const [comment] = await db.insert(comments).values({
    wikiPageId: pageId,
    userId,
    content: body.content,
    mentions: body.mentions || [],
    parentId: body.parentId,
  }).returning();

  return c.json({ data: comment }, 201);
});

app.post('/pages/:pageId/comments/:commentId/resolve', async (c) => {
  const commentId = c.req.param('commentId')!;

  await db.update(comments).set({ resolved: true, updatedAt: new Date() }).where(eq(comments.id, commentId));

  return c.json({ data: { resolved: true } });
});

app.post('/pages/:pageId/edit-request', async (c) => {
  const workspaceId = c.req.param('workspaceId')!;
  const pageId = c.req.param('pageId')!;
  const userId = c.get('userId' as never) as string;
  const body = await c.req.json<{ proposedContent: string }>();

  const [request] = await db.insert(editRequests).values({
    wikiPageId: pageId,
    workspaceId,
    requestedBy: userId,
    proposedContent: body.proposedContent,
  }).returning();

  return c.json({ data: request }, 201);
});

app.get('/edit-requests', async (c) => {
  const workspaceId = c.req.param('workspaceId')!;
  const status = c.req.query('status') || 'pending';

  const result = await db.query.editRequests.findMany({
    where: and(
      eq(editRequests.workspaceId, workspaceId),
      eq(editRequests.status, status as 'pending' | 'approved' | 'rejected'),
    ),
    orderBy: [desc(editRequests.createdAt)],
  });

  return c.json({ data: result });
});

app.post('/edit-requests/:id/review', async (c) => {
  const id = c.req.param('id')!;
  const userId = c.get('userId' as never) as string;
  const body = await c.req.json<{ action: 'approve' | 'reject'; comment?: string }>();

  const request = await db.query.editRequests.findFirst({
    where: eq(editRequests.id, id),
  });
  if (!request) return c.json({ error: 'Not found' }, 404);

  if (body.action === 'approve') {
    const currentPage = await db.query.wikiPages.findFirst({
      where: eq(wikiPages.id, request.wikiPageId),
    });

    if (currentPage) {
      await db.insert(wikiPageVersions).values({
        wikiPageId: request.wikiPageId,
        contentSnapshot: currentPage.content,
        changeType: 'manual_edit',
        changedBy: request.requestedBy,
      });

      await db.update(wikiPages).set({
        content: request.proposedContent,
        lockVersion: sql`${wikiPages.lockVersion} + 1`,
        updatedAt: new Date(),
      }).where(eq(wikiPages.id, request.wikiPageId));
    }
  }

  await db.update(editRequests).set({
    status: body.action === 'approve' ? 'approved' : 'rejected',
    reviewedBy: userId,
    reviewComment: body.comment,
    updatedAt: new Date(),
  }).where(eq(editRequests.id, id));

  return c.json({ data: { reviewed: true, action: body.action } });
});

export default app;

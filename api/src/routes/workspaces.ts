import { Hono } from 'hono';
import { db } from '../lib/db.js';
import { workspaces, members } from '../db/schema/index.js';
import { eq, inArray } from 'drizzle-orm';

type Env = { Variables: { userId: string } };

const app = new Hono<Env>();

app.get('/', async (c) => {
  const userId = c.get('userId');

  const userOrgs = await db.query.members.findMany({
    where: eq(members.userId, userId),
    columns: { organizationId: true },
  });
  const orgIds = userOrgs.map((m) => m.organizationId);

  if (orgIds.length === 0) return c.json({ data: [] });

  const result = await db.query.workspaces.findMany({
    where: inArray(workspaces.organizationId, orgIds),
    orderBy: (w, { desc }) => [desc(w.updatedAt)],
  });
  return c.json({ data: result });
});

app.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ name: string; description?: string; organizationId: string }>();

  const membership = await db.query.members.findFirst({
    where: (m, { and, eq: e }) =>
      and(e(m.userId, userId), e(m.organizationId, body.organizationId)),
  });
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const [workspace] = await db
    .insert(workspaces)
    .values({
      organizationId: body.organizationId,
      name: body.name,
      description: body.description ?? null,
    })
    .returning();

  return c.json({ data: workspace }, 201);
});

app.get('/:id', async (c) => {
  const id = c.req.param('id')!;
  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, id),
  });

  if (!workspace) return c.json({ error: 'Not found' }, 404);
  return c.json({ data: workspace });
});

export default app;

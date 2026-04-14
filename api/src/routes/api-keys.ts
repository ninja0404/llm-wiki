import { Hono } from 'hono';
import { db } from '../lib/db.js';
import { apiKeys, members, workspaces } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import { generateApiKey } from '../lib/api-key-auth.js';

const app = new Hono();

app.post('/', async (c) => {
  const userId = c.get('userId' as never) as string;
  const body = await c.req.json<{ name: string; scope?: 'read' | 'write' | 'admin'; organizationId: string }>();

  const member = await db.query.members.findFirst({
    where: and(eq(members.userId, userId), eq(members.organizationId, body.organizationId)),
  });
  if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
    return c.json({ error: 'Only org admins can create API keys' }, 403);
  }

  const { key, hash, prefix } = generateApiKey();

  const [apiKey] = await db
    .insert(apiKeys)
    .values({
      organizationId: body.organizationId,
      name: body.name,
      keyHash: hash,
      keyPrefix: prefix,
      scope: body.scope || 'read',
    })
    .returning();

  return c.json({
    data: {
      id: apiKey.id,
      name: apiKey.name,
      key,
      keyPrefix: prefix,
      scope: apiKey.scope,
      createdAt: apiKey.createdAt,
    },
  }, 201);
});

app.get('/', async (c) => {
  const userId = c.get('userId' as never) as string;
  const organizationId = c.req.query('organizationId');
  if (!organizationId) return c.json({ error: 'Missing organizationId' }, 400);

  const keys = await db.query.apiKeys.findMany({
    where: and(
      eq(apiKeys.organizationId, organizationId),
      isNull(apiKeys.revokedAt),
    ),
    columns: {
      id: true,
      name: true,
      keyPrefix: true,
      scope: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  return c.json({ data: keys });
});

app.delete('/:id', async (c) => {
  const id = c.req.param('id')!;

  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(apiKeys.id, id));

  return c.json({ data: { revoked: true } });
});

export default app;

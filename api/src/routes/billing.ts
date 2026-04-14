import { Hono } from 'hono';
import { db } from '../lib/db.js';
import { subscriptions, PLAN_LIMITS } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';

const app = new Hono();

app.get('/subscription', async (c) => {
  const organizationId = c.req.query('organizationId');
  if (!organizationId) return c.json({ error: 'Missing organizationId' }, 400);

  let sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.organizationId, organizationId),
  });

  if (!sub) {
    [sub] = await db.insert(subscriptions).values({
      organizationId,
      plan: 'free',
    }).returning();
  }

  return c.json({ data: sub });
});

app.get('/plans', async (c) => {
  return c.json({
    data: Object.entries(PLAN_LIMITS).map(([plan, limits]) => ({
      plan,
      ...limits,
    })),
  });
});

app.post('/subscription/upgrade', async (c) => {
  const body = await c.req.json<{ organizationId: string; plan: 'free' | 'pro' | 'enterprise' }>();
  const limits = PLAN_LIMITS[body.plan];

  await db
    .update(subscriptions)
    .set({
      plan: body.plan,
      tokenBudgetMonthly: limits.tokenBudget,
      storageLimitBytes: limits.storageBytes,
      maxWorkspaces: limits.workspaces,
      maxMembers: limits.members,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.organizationId, body.organizationId));

  return c.json({ data: { upgraded: true, plan: body.plan } });
});

export default app;

import { Hono } from 'hono';
import { db } from '../lib/db.js';
import { subscriptions, PLAN_LIMITS } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { logger } from '../lib/logger.js';
import { stripe, STRIPE_WEBHOOK_SECRET, PRICE_IDS } from '../lib/stripe.js';

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

app.post('/checkout', async (c) => {
  if (!stripe) return c.json({ error: 'Stripe not configured' }, 503);

  const body = await c.req.json<{ organizationId: string; plan: 'pro' | 'enterprise' }>();
  const priceId = PRICE_IDS[body.plan];
  if (!priceId) return c.json({ error: 'Invalid plan' }, 400);

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.BASE_URL || 'http://localhost:5173'}/settings?billing=success`,
    cancel_url: `${process.env.BASE_URL || 'http://localhost:5173'}/settings?billing=canceled`,
    metadata: { organizationId: body.organizationId, plan: body.plan },
  });

  return c.json({ data: { checkoutUrl: session.url } });
});

app.post('/webhook', async (c) => {
  const signature = c.req.header('stripe-signature');
  if (!signature) return c.json({ error: 'Missing signature' }, 400);

  const rawBody = await c.req.text();

  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    if (stripe && STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET) as unknown as typeof event;
    } else {
      event = JSON.parse(rawBody);
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        logger.info({ sessionId: session.id }, 'Checkout session completed');
        break;
      }
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        logger.info({ subscriptionId: subscription.id, status: subscription.status }, 'Subscription updated');

        if (subscription.metadata && typeof subscription.metadata === 'object') {
          const orgId = (subscription.metadata as Record<string, string>).organizationId;
          if (orgId) {
            await db
              .update(subscriptions)
              .set({
                stripeSubscriptionId: subscription.id as string,
                status: (subscription.status as string) === 'active' ? 'active' : 'past_due',
                updatedAt: new Date(),
              })
              .where(eq(subscriptions.organizationId, orgId));
          }
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        logger.info({ subscriptionId: subscription.id }, 'Subscription canceled');
        break;
      }
      default:
        logger.debug({ type: event.type }, 'Unhandled webhook event');
    }

    return c.json({ received: true });
  } catch (err) {
    logger.error({ err }, 'Webhook processing failed');
    return c.json({ error: 'Webhook processing failed' }, 400);
  }
});

export default app;

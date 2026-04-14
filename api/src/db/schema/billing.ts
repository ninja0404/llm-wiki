import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  bigint,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organizations } from './workspace.js';

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    plan: text('plan', { enum: ['free', 'pro', 'enterprise'] }).notNull().default('free'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    status: text('status', { enum: ['active', 'canceled', 'past_due', 'trialing'] }).notNull().default('active'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    tokenBudgetMonthly: bigint('token_budget_monthly', { mode: 'number' }).notNull().default(500_000),
    storageLimitBytes: bigint('storage_limit_bytes', { mode: 'number' }).notNull().default(1_073_741_824),
    maxWorkspaces: integer('max_workspaces').notNull().default(1),
    maxMembers: integer('max_members').notNull().default(3),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('subscription_org_idx').on(t.organizationId),
    index('subscription_stripe_idx').on(t.stripeCustomerId),
  ],
);

export const PLAN_LIMITS = {
  free: { tokenBudget: 500_000, storageBytes: 1_073_741_824, workspaces: 1, members: 3 },
  pro: { tokenBudget: 5_000_000, storageBytes: 10_737_418_240, workspaces: 5, members: 20 },
  enterprise: { tokenBudget: 50_000_000, storageBytes: 107_374_182_400, workspaces: 50, members: 200 },
} as const;

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  organization: one(organizations, {
    fields: [subscriptions.organizationId],
    references: [organizations.id],
  }),
}));

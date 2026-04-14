import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  bigint,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { workspaces } from './workspace.js';

export const activityLogs = pgTable(
  'activity_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    details: jsonb('details').$type<Record<string, unknown>>(),
    traceId: uuid('trace_id'),
    userId: text('user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('activity_workspace_idx').on(t.workspaceId),
    index('activity_trace_idx').on(t.traceId),
    index('activity_created_idx').on(t.createdAt),
  ],
);

export const llmInvocations = pgTable(
  'llm_invocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    step: text('step').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: text('cost_usd'),
    durationMs: integer('duration_ms'),
    sourceId: uuid('source_id'),
    batchIndex: integer('batch_index'),
    promptVersion: text('prompt_version'),
    traceId: uuid('trace_id'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('llm_workspace_idx').on(t.workspaceId),
    index('llm_trace_idx').on(t.traceId),
    index('llm_created_idx').on(t.createdAt),
    uniqueIndex('llm_idempotent_idx').on(t.sourceId, t.batchIndex, t.step),
  ],
);

export const workspaceUsage = pgTable(
  'workspace_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    period: text('period').notNull(),
    tokensUsed: bigint('tokens_used', { mode: 'number' }).notNull().default(0),
    tokensBudget: bigint('tokens_budget', { mode: 'number' }).notNull().default(2_000_000),
    storageBytes: bigint('storage_bytes', { mode: 'number' }).notNull().default(0),
    apiCalls: integer('api_calls').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('usage_workspace_period_idx').on(t.workspaceId, t.period),
  ],
);

// ── Relations ──

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [activityLogs.workspaceId],
    references: [workspaces.id],
  }),
}));

export const llmInvocationsRelations = relations(llmInvocations, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [llmInvocations.workspaceId],
    references: [workspaces.id],
  }),
}));

export const workspaceUsageRelations = relations(workspaceUsage, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceUsage.workspaceId],
    references: [workspaces.id],
  }),
}));

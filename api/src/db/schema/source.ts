import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  jsonb,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { workspaces } from './workspace.js';

const vector = customType<{ data: number[]; driverParam: string }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value: number[]) {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: unknown) {
    const str = value as string;
    return str
      .slice(1, -1)
      .split(',')
      .map(Number);
  },
});

export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    sourceType: text('source_type', { enum: ['text', 'url', 'file'] }).notNull(),
    rawContent: text('raw_content'),
    url: text('url'),
    fileKey: text('file_key'),
    contentHash: text('content_hash'),
    status: text('status', {
      enum: ['pending', 'processing', 'completed', 'partial_failure', 'failed'],
    })
      .notNull()
      .default('pending'),
    ingestState: jsonb('ingest_state').$type<{
      totalBatches: number;
      completedBatches: number;
      failedBatches: number[];
    }>(),
    traceId: uuid('trace_id'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('source_workspace_idx').on(t.workspaceId),
    index('source_hash_idx').on(t.contentHash),
  ],
);

export const sourceChunks = pgTable(
  'source_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    tokenCount: integer('token_count'),
    contentHash: text('content_hash'),
    embedding: vector('embedding'),
    embeddingModel: text('embedding_model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('chunk_source_idx').on(t.sourceId),
    index('chunk_hash_idx').on(t.contentHash),
  ],
);

export const sourceExtractions = pgTable(
  'source_extractions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    entityName: text('entity_name').notNull(),
    slug: text('slug').notNull(),
    entityType: text('entity_type', {
      enum: ['person', 'project', 'technology', 'company', 'concept', 'methodology'],
    }).notNull(),
    description: text('description').notNull(),
    sourceChunkIds: text('source_chunk_ids').array().notNull(),
    confidence: text('confidence', { enum: ['high', 'medium', 'low'] })
      .notNull()
      .default('medium'),
    batchIndex: integer('batch_index').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('extraction_source_idx').on(t.sourceId),
    index('extraction_slug_idx').on(t.slug),
  ],
);

// ── Relations ──

export const sourcesRelations = relations(sources, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [sources.workspaceId],
    references: [workspaces.id],
  }),
  chunks: many(sourceChunks),
  extractions: many(sourceExtractions),
}));

export const sourceChunksRelations = relations(sourceChunks, ({ one }) => ({
  source: one(sources, {
    fields: [sourceChunks.sourceId],
    references: [sources.id],
  }),
}));

export const sourceExtractionsRelations = relations(sourceExtractions, ({ one }) => ({
  source: one(sources, {
    fields: [sourceExtractions.sourceId],
    references: [sources.id],
  }),
}));

export { vector };

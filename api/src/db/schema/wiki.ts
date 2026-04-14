import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { workspaces } from './workspace.js';
import { sources } from './source.js';
import { sourceChunks, vector } from './source.js';

export const wikiPages = pgTable(
  'wiki_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    summary: text('summary'),
    content: text('content').notNull(),
    pageType: text('page_type', {
      enum: ['entity', 'concept', 'source_summary', 'comparison', 'overview'],
    })
      .notNull()
      .default('entity'),
    tags: text('tags').array().default([]),
    status: text('status', {
      enum: ['draft', 'published', 'archived', 'flagged'],
    })
      .notNull()
      .default('draft'),
    confidence: text('confidence', { enum: ['high', 'medium', 'low'] }),
    lockVersion: integer('lock_version').notNull().default(1),
    embedding: vector('embedding'),
    embeddingModel: text('embedding_model'),
    lastLintAt: timestamp('last_lint_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('wiki_workspace_slug_idx').on(t.workspaceId, t.slug),
    index('wiki_workspace_idx').on(t.workspaceId),
    index('wiki_status_idx').on(t.status),
  ],
);

export const wikiPageVersions = pgTable(
  'wiki_page_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    wikiPageId: uuid('wiki_page_id')
      .notNull()
      .references(() => wikiPages.id, { onDelete: 'cascade' }),
    contentSnapshot: text('content_snapshot').notNull(),
    changeType: text('change_type', {
      enum: ['llm_ingest', 'llm_lint', 'manual_edit'],
    }).notNull(),
    changedBy: text('changed_by'),
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
    promptVersion: text('prompt_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('version_page_idx').on(t.wikiPageId)],
);

export const wikiPageChunks = pgTable(
  'wiki_page_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    wikiPageId: uuid('wiki_page_id')
      .notNull()
      .references(() => wikiPages.id, { onDelete: 'cascade' }),
    sourceChunkId: uuid('source_chunk_id')
      .notNull()
      .references(() => sourceChunks.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('page_chunk_unique_idx').on(t.wikiPageId, t.sourceChunkId),
    index('page_chunk_wiki_idx').on(t.wikiPageId),
    index('page_chunk_source_idx').on(t.sourceChunkId),
  ],
);

export const wikiLinks = pgTable(
  'wiki_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourcePageId: uuid('source_page_id')
      .notNull()
      .references(() => wikiPages.id, { onDelete: 'cascade' }),
    targetPageId: uuid('target_page_id')
      .notNull()
      .references(() => wikiPages.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('link_unique_idx').on(t.sourcePageId, t.targetPageId),
    index('link_source_idx').on(t.sourcePageId),
    index('link_target_idx').on(t.targetPageId),
  ],
);

// ── Relations ──

export const wikiPagesRelations = relations(wikiPages, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [wikiPages.workspaceId],
    references: [workspaces.id],
  }),
  versions: many(wikiPageVersions),
  pageChunks: many(wikiPageChunks),
  outgoingLinks: many(wikiLinks, { relationName: 'outgoing' }),
  incomingLinks: many(wikiLinks, { relationName: 'incoming' }),
}));

export const wikiPageVersionsRelations = relations(wikiPageVersions, ({ one }) => ({
  wikiPage: one(wikiPages, {
    fields: [wikiPageVersions.wikiPageId],
    references: [wikiPages.id],
  }),
  source: one(sources, {
    fields: [wikiPageVersions.sourceId],
    references: [sources.id],
  }),
}));

export const wikiPageChunksRelations = relations(wikiPageChunks, ({ one }) => ({
  wikiPage: one(wikiPages, {
    fields: [wikiPageChunks.wikiPageId],
    references: [wikiPages.id],
  }),
  sourceChunk: one(sourceChunks, {
    fields: [wikiPageChunks.sourceChunkId],
    references: [sourceChunks.id],
  }),
}));

export const wikiLinksRelations = relations(wikiLinks, ({ one }) => ({
  sourcePage: one(wikiPages, {
    fields: [wikiLinks.sourcePageId],
    references: [wikiPages.id],
    relationName: 'outgoing',
  }),
  targetPage: one(wikiPages, {
    fields: [wikiLinks.targetPageId],
    references: [wikiPages.id],
    relationName: 'incoming',
  }),
}));

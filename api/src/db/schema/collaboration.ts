import {
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { wikiPages } from './wiki.js';
import { workspaces } from './workspace.js';

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    wikiPageId: uuid('wiki_page_id')
      .notNull()
      .references(() => wikiPages.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    content: text('content').notNull(),
    mentions: text('mentions').array().default([]),
    resolved: boolean('resolved').notNull().default(false),
    parentId: uuid('parent_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('comment_page_idx').on(t.wikiPageId),
    index('comment_user_idx').on(t.userId),
  ],
);

export const editRequests = pgTable(
  'edit_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    wikiPageId: uuid('wiki_page_id')
      .notNull()
      .references(() => wikiPages.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    requestedBy: text('requested_by').notNull(),
    proposedContent: text('proposed_content').notNull(),
    status: text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull().default('pending'),
    reviewedBy: text('reviewed_by'),
    reviewComment: text('review_comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('edit_request_page_idx').on(t.wikiPageId),
    index('edit_request_workspace_idx').on(t.workspaceId),
    index('edit_request_status_idx').on(t.status),
  ],
);

export const commentsRelations = relations(comments, ({ one }) => ({
  wikiPage: one(wikiPages, {
    fields: [comments.wikiPageId],
    references: [wikiPages.id],
  }),
}));

export const editRequestsRelations = relations(editRequests, ({ one }) => ({
  wikiPage: one(wikiPages, {
    fields: [editRequests.wikiPageId],
    references: [wikiPages.id],
  }),
  workspace: one(workspaces, {
    fields: [editRequests.workspaceId],
    references: [workspaces.id],
  }),
}));

import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { workspaces } from './workspace.js';

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    title: text('title'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('conv_workspace_idx').on(t.workspaceId),
    index('conv_user_idx').on(t.userId),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    content: text('content').notNull(),
    citations: jsonb('citations').$type<
      {
        wikiPageId: string;
        wikiPageTitle: string;
        sourceChunkId: string | null;
        excerpt: string;
      }[]
    >(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('msg_conv_idx').on(t.conversationId)],
);

// ── Relations ──

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [conversations.workspaceId],
    references: [workspaces.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

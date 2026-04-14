import { db } from '../lib/db.js';
import { wikiPages, sourceChunks } from '../db/schema/index.js';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { generateEmbedding } from '../llm/invoke.js';
import { type TenantLLMConfig, defaultConfig } from '../llm/provider.js';
import { logger } from '../lib/logger.js';

interface MigrateJobData {
  workspaceId: string;
  newModel: string;
  batchSize?: number;
  llmConfig?: TenantLLMConfig;
}

export async function processEmbeddingMigration(data: MigrateJobData): Promise<{
  processedPages: number;
  processedChunks: number;
  remaining: number;
}> {
  const { workspaceId, newModel, batchSize = 50 } = data;
  const llmConfig = data.llmConfig ?? defaultConfig;

  const unmigrated = await db.execute(sql`
    SELECT id, title, summary, content
    FROM wiki_pages
    WHERE workspace_id = ${workspaceId}
      AND deleted_at IS NULL
      AND (embedding_migrated IS NULL OR embedding_migrated = false)
    LIMIT ${batchSize}
  `);

  let processedPages = 0;
  for (const row of unmigrated.rows as Record<string, unknown>[]) {
    try {
      const text = `${row.title}\n${row.summary || ''}\n${(row.content as string).slice(0, 500)}`;
      const embedding = await generateEmbedding(llmConfig, text);

      await db.execute(sql`
        UPDATE wiki_pages
        SET embedding_v2 = ${`[${embedding.join(',')}]`}::vector,
            embedding_v2_model = ${newModel},
            embedding_migrated = true,
            updated_at = now()
        WHERE id = ${row.id as string}
      `);
      processedPages++;
    } catch (err) {
      logger.warn({ pageId: row.id, err }, 'Failed to migrate embedding for page');
    }
  }

  const remainingResult = await db.execute(sql`
    SELECT count(*)::int as cnt
    FROM wiki_pages
    WHERE workspace_id = ${workspaceId}
      AND deleted_at IS NULL
      AND (embedding_migrated IS NULL OR embedding_migrated = false)
  `);
  const remaining = (remainingResult.rows[0] as { cnt: number })?.cnt ?? 0;

  logger.info({ workspaceId, processedPages, remaining, newModel }, 'Embedding migration batch completed');

  return { processedPages, processedChunks: 0, remaining };
}

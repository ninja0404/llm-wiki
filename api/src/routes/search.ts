import { Hono } from 'hono';
import { db } from '../lib/db.js';
import { wikiPages, sourceChunks, sources } from '../db/schema/index.js';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { hybridSearch } from '../search/engine.js';

const app = new Hono();

app.get('/', async (c) => {
  const workspaceId = c.req.param('workspaceId')!;
  const query = c.req.query('q') || '';
  const limit = Math.min(Number(c.req.query('limit') || 20), 50);

  if (!query.trim()) {
    return c.json({ data: { pages: [], total: 0, query, indexingInProgress: false } });
  }

  const results = await hybridSearch(workspaceId, query, limit);

  const nullEmbeddingCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(wikiPages)
    .where(
      and(
        eq(wikiPages.workspaceId, workspaceId),
        isNull(wikiPages.deletedAt),
        isNull(wikiPages.embedding),
      ),
    )
    .then((r) => r[0]?.count ?? 0);

  // Also search source chunks for supplementary detail
  const tsQuery = query.split(/\s+/).filter(Boolean).map((t) => `${t}:*`).join(' & ');
  let chunkResults: { id: string; content: string; sourceTitle: string }[] = [];
  if (tsQuery) {
    const chunks = await db.execute(sql`
      SELECT sc.id, sc.content, s.title as source_title
      FROM source_chunks sc
      JOIN sources s ON s.id = sc.source_id
      WHERE s.workspace_id = ${workspaceId}
        AND to_tsvector('english', sc.content) @@ to_tsquery('english', ${tsQuery})
      ORDER BY ts_rank(to_tsvector('english', sc.content), to_tsquery('english', ${tsQuery})) DESC
      LIMIT 5
    `);
    chunkResults = (chunks.rows as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      content: (r.content as string).slice(0, 200),
      sourceTitle: r.source_title as string,
    }));
  }

  return c.json({
    data: {
      pages: results,
      chunks: chunkResults,
      total: results.length,
      query,
      indexingInProgress: nullEmbeddingCount > 0,
    },
  });
});

export default app;

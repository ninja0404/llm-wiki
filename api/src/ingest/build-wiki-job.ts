import { db } from '../lib/db.js';
import {
  sources,
  sourceExtractions,
  wikiPages,
  wikiPageVersions,
  wikiPageChunks,
  wikiLinks,
  activityLogs,
} from '../db/schema/index.js';
import { eq, and, sql } from 'drizzle-orm';
import { invokeStructured, generateEmbedding } from '../llm/invoke.js';
import { wikiDecisionSchema } from '../llm/schemas.js';
import {
  WIKI_BUILD_SYSTEM,
  buildWikiBuildPrompt,
  WIKI_BUILD_PROMPT_V1,
} from '../llm/prompts.js';
import { defaultConfig, type TenantLLMConfig } from '../llm/provider.js';
import { embeddingQueue } from '../jobs/queues.js';
import { publishMessage } from '../lib/ws.js';
import { logger } from '../lib/logger.js';
import { BUILD_BATCH_SIZE, INDEX_TOKEN_BUDGET } from '@llm-wiki/shared';
import { cacheInvalidate, CACHE_KEYS } from '../lib/cache.js';

interface BuildWikiJobData {
  sourceId: string;
  workspaceId: string;
  traceId: string;
  llmConfig?: TenantLLMConfig;
}

export async function processBuildWikiJob(data: BuildWikiJobData) {
  const { sourceId, workspaceId, traceId } = data;
  const llmConfig = data.llmConfig ?? defaultConfig;

  const extractions = await db.query.sourceExtractions.findMany({
    where: eq(sourceExtractions.sourceId, sourceId),
  });

  if (extractions.length === 0) {
    logger.warn({ sourceId }, 'No extractions found, skipping wiki build');
    return;
  }

  // Load wiki index — token budget driven full vs hybrid
  const allPages = await db.query.wikiPages.findMany({
    where: eq(wikiPages.workspaceId, workspaceId),
    columns: { id: true, slug: true, title: true, summary: true },
  });
  const indexTokens = allPages.reduce(
    (sum, p) => sum + Math.ceil((`${p.title} ${p.summary || ''}`.length) / 4),
    0,
  );
  const useFullIndex = indexTokens < INDEX_TOKEN_BUDGET;

  // Process in batches
  const batches: typeof extractions[] = [];
  for (let i = 0; i < extractions.length; i += BUILD_BATCH_SIZE) {
    batches.push(extractions.slice(i, i + BUILD_BATCH_SIZE));
  }

  for (const batch of batches) {
    const entityNames = batch.map((e) => e.entityName);
    const entitySlugs = batch.map((e) => e.slug);

    let wikiIndex = allPages;

    if (!useFullIndex) {
      // Hybrid Index Lookup: pg_trgm + vector
      // Step 2a: trigram similarity match on title
      const trigramMatches = await db.execute(sql`
        SELECT id, slug, title, summary
        FROM wiki_pages
        WHERE workspace_id = ${workspaceId}
          AND deleted_at IS NULL
          AND (${sql.join(entityNames.map((name) => sql`title % ${name}`), sql` OR `)})
        LIMIT 30
      `);

      // Step 2b: vector semantic match (if embeddings available)
      const vectorMatches = await db.execute(sql`
        SELECT id, slug, title, summary
        FROM wiki_pages
        WHERE workspace_id = ${workspaceId}
          AND deleted_at IS NULL
          AND embedding IS NOT NULL
        ORDER BY embedding <=> (
          SELECT embedding FROM source_extractions se
          JOIN source_chunks sc ON sc.id = ANY(se.source_chunk_ids)
          WHERE se.source_id = ${sourceId}
          LIMIT 1
        )
        LIMIT 20
      `).catch(() => ({ rows: [] }));

      // Step 2c: merge + dedup
      const mergedMap = new Map<string, typeof allPages[0]>();
      for (const row of [...(trigramMatches.rows as typeof allPages), ...(vectorMatches.rows as typeof allPages)]) {
        if (!mergedMap.has(row.id)) mergedMap.set(row.id, row);
      }
      wikiIndex = [...mergedMap.values()];
    }

    const matchedPages = wikiIndex.filter((p) => entitySlugs.includes(p.slug));

    let existingPages: { id: string; slug: string; content: string }[] = [];
    if (matchedPages.length > 0) {
      existingPages = await db.query.wikiPages.findMany({
        where: and(
          eq(wikiPages.workspaceId, workspaceId),
          sql`${wikiPages.slug} = ANY(${entitySlugs})`,
        ),
        columns: { id: true, slug: true, content: true },
      });
    }

    const entities = batch.map((e) => ({
      slug: e.slug,
      name: e.entityName,
      type: e.entityType,
      description: e.description,
    }));

    const result = await invokeStructured({
      config: llmConfig,
      workspaceId,
      system: WIKI_BUILD_SYSTEM,
      prompt: buildWikiBuildPrompt(entities, wikiIndex, existingPages),
      schema: wikiDecisionSchema,
      step: 'wiki-build',
      promptVersion: WIKI_BUILD_PROMPT_V1,
      traceId,
      sourceId,
    });

    for (const decision of result.decisions) {
      if (decision.action === 'create') {
        await createWikiPage(decision, workspaceId, sourceId, traceId, llmConfig, batch);
      } else if (decision.action === 'update' && decision.matchedPageId) {
        await updateWikiPage(decision, decision.matchedPageId, sourceId, traceId, llmConfig, batch);
      } else if (decision.action === 'flag') {
        await createFlaggedPage(decision, workspaceId, sourceId, traceId);
      }
    }
  }

  // Mark source completed
  await db
    .update(sources)
    .set({ status: 'completed', updatedAt: new Date() })
    .where(eq(sources.id, sourceId));

  await db.insert(activityLogs).values({
    workspaceId,
    action: 'wiki_build_completed',
    entityType: 'source',
    entityId: sourceId,
    traceId,
  });

  await publishMessage(workspaceId, {
    type: 'ingest:progress',
    payload: { sourceId, totalBatches: 0, completedBatches: 0, failedBatches: [], status: 'completed' },
  });

  logger.info({ sourceId, traceId }, 'Wiki build completed');
}

async function createWikiPage(
  decision: { entitySlug: string; title: string; content: string; summary: string; pageType: string; tags: string[]; confidence: string; links: string[] },
  workspaceId: string,
  sourceId: string,
  traceId: string,
  llmConfig: TenantLLMConfig,
  extractions: { sourceChunkIds: string[] }[],
) {
  let embedding: number[] | null = null;
  try {
    embedding = await generateEmbedding(llmConfig, `${decision.title}\n${decision.summary}\n${decision.content.slice(0, 500)}`);
  } catch {
    // will be filled by embedding-update queue
  }

  const [page] = await db
    .insert(wikiPages)
    .values({
      workspaceId,
      title: decision.title,
      slug: decision.entitySlug,
      summary: decision.summary,
      content: decision.content,
      pageType: decision.pageType as 'entity' | 'concept' | 'source_summary' | 'comparison' | 'overview',
      tags: decision.tags,
      status: 'published',
      confidence: decision.confidence as 'high' | 'medium' | 'low',
      embedding,
      embeddingModel: embedding ? 'text-embedding-3-small' : null,
    })
    .onConflictDoNothing()
    .returning();

  if (!page) {
    logger.info({ slug: decision.entitySlug }, 'Page already exists, skipping create');
    return;
  }

  // Link source chunks
  const allChunkIds = extractions.flatMap((e) => e.sourceChunkIds);
  for (const chunkId of [...new Set(allChunkIds)]) {
    await db.insert(wikiPageChunks).values({
      wikiPageId: page.id,
      sourceChunkId: chunkId,
    }).onConflictDoNothing();
  }

  // Link Validation: verify [[links]] targets exist, create stubs for missing
  for (const targetSlug of decision.links) {
    let target = await db.query.wikiPages.findFirst({
      where: and(eq(wikiPages.workspaceId, workspaceId), eq(wikiPages.slug, targetSlug)),
      columns: { id: true },
    });

    if (!target) {
      const [stub] = await db
        .insert(wikiPages)
        .values({
          workspaceId,
          title: targetSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          slug: targetSlug,
          content: `*This page has not been created yet.*`,
          status: 'draft',
          pageType: 'entity',
        })
        .onConflictDoNothing()
        .returning();
      if (stub) target = stub;
    }

    if (target) {
      await db.insert(wikiLinks).values({
        sourcePageId: page.id,
        targetPageId: target.id,
      }).onConflictDoNothing();
    }
  }

  // Enqueue embedding async update
  if (!embedding) {
    await embeddingQueue.add('update', { pageId: page.id, workspaceId }, { jobId: `embed-${page.id}` });
  }

  await cacheInvalidate(CACHE_KEYS.wikiPage(workspaceId, decision.entitySlug));

  await publishMessage(workspaceId, {
    type: 'wiki:page:created',
    payload: { pageId: page.id, title: decision.title, slug: decision.entitySlug },
  });

  logger.info({ pageId: page.id, title: decision.title }, 'Wiki page created');
}

async function updateWikiPage(
  decision: { entitySlug: string; title: string; content: string; summary: string; tags: string[]; confidence: string },
  pageId: string,
  sourceId: string,
  traceId: string,
  _llmConfig: TenantLLMConfig,
  _extractions: { sourceChunkIds: string[] }[],
) {
  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const currentPage = await db.query.wikiPages.findFirst({
      where: eq(wikiPages.id, pageId),
    });
    if (!currentPage) return;

    if (attempt === 1) {
      await db.insert(wikiPageVersions).values({
        wikiPageId: pageId,
        contentSnapshot: currentPage.content,
        changeType: 'llm_ingest',
        sourceId,
        promptVersion: WIKI_BUILD_PROMPT_V1,
      });
    }

    const result = await db
      .update(wikiPages)
      .set({
        content: decision.content,
        summary: decision.summary,
        tags: decision.tags,
        confidence: decision.confidence as 'high' | 'medium' | 'low',
        lockVersion: sql`${wikiPages.lockVersion} + 1`,
        embedding: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(wikiPages.id, pageId),
          eq(wikiPages.lockVersion, currentPage.lockVersion),
        ),
      )
      .returning();

    if (result.length > 0) {
      await embeddingQueue.add('update', { pageId, workspaceId: currentPage.workspaceId }, { jobId: `embed-${pageId}` });
      await cacheInvalidate(CACHE_KEYS.wikiPage(currentPage.workspaceId, decision.entitySlug));

      await publishMessage(currentPage.workspaceId, {
        type: 'wiki:page:updated',
        payload: { pageId, title: decision.title, changeType: 'llm_ingest' },
      });
      logger.info({ pageId, title: decision.title, attempt }, 'Wiki page updated');
      return;
    }

    logger.warn({ pageId, attempt }, 'CAS failed, retrying...');
  }

  // Both attempts failed
  const page = await db.query.wikiPages.findFirst({
    where: eq(wikiPages.id, pageId),
    columns: { workspaceId: true },
  });
  if (page) {
    await db.insert(activityLogs).values({
      workspaceId: page.workspaceId,
      action: 'ingest_conflict',
      entityType: 'wiki_page',
      entityId: pageId,
      traceId,
      details: { message: `Page "${decision.title}" was concurrently modified. LLM update needs manual review.` },
    });
  }
  logger.error({ pageId, traceId }, 'CAS failed after max attempts');
}

async function createFlaggedPage(
  decision: { entitySlug: string; title: string; content: string; summary: string; flagReason: string | null },
  workspaceId: string,
  sourceId: string,
  traceId: string,
) {
  await db.insert(wikiPages).values({
    workspaceId,
    title: decision.title,
    slug: decision.entitySlug,
    summary: decision.summary,
    content: decision.content,
    status: 'flagged',
    confidence: 'low',
  }).onConflictDoNothing();

  const flaggedCount = await db
    .select({ count: sql`count(*)::int` })
    .from(wikiPages)
    .where(and(eq(wikiPages.workspaceId, workspaceId), eq(wikiPages.status, 'flagged')))
    .then((r) => (r[0] as { count: number })?.count ?? 0);

  if (flaggedCount >= 20) {
    await publishMessage(workspaceId, {
      type: 'flagged:alert',
      payload: { workspaceId, pendingCount: flaggedCount },
    });
  }

  logger.info({ slug: decision.entitySlug, reason: decision.flagReason, flaggedCount }, 'Page flagged for review');
}

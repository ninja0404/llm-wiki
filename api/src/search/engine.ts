import { db } from '../lib/db.js';
import { wikiPages, sourceChunks } from '../db/schema/index.js';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { generateEmbedding } from '../llm/invoke.js';
import { defaultConfig, type TenantLLMConfig } from '../llm/provider.js';
import { RRF_K, SEARCH_TOP_K } from '@llm-wiki/shared';
import { cacheGet, cacheSet, CACHE_KEYS } from '../lib/cache.js';
import { createHash } from 'crypto';

export interface SearchHit {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  pageType: string;
  score: number;
  matchType: 'semantic' | 'fts' | 'hybrid';
}

export async function hybridSearch(
  workspaceId: string,
  query: string,
  limit = SEARCH_TOP_K,
  llmConfig?: TenantLLMConfig,
): Promise<SearchHit[]> {
  const config = llmConfig ?? defaultConfig;
  const queryHash = createHash('sha256').update(query.toLowerCase().trim()).digest('hex').slice(0, 16);
  const cacheKey = CACHE_KEYS.queryResult(workspaceId, queryHash);

  const cached = await cacheGet<SearchHit[]>(cacheKey);
  if (cached) return cached;

  const [vectorResults, ftsResults] = await Promise.all([
    vectorSearch(workspaceId, query, limit, config),
    fullTextSearch(workspaceId, query, limit),
  ]);

  const results = rrfMerge(vectorResults, ftsResults, limit);
  await cacheSet(cacheKey, results, 3600);
  return results;
}

async function vectorSearch(
  workspaceId: string,
  query: string,
  limit: number,
  llmConfig: TenantLLMConfig,
): Promise<SearchHit[]> {
  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateEmbedding(llmConfig, query);
  } catch {
    return [];
  }

  const vectorStr = `[${queryEmbedding.join(',')}]`;

  const results = await db.execute(sql`
    SELECT
      id, title, slug, summary, page_type,
      1 - (embedding <=> ${vectorStr}::vector) as similarity
    FROM wiki_pages
    WHERE workspace_id = ${workspaceId}
      AND deleted_at IS NULL
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `);

  return (results.rows as Record<string, unknown>[]).map((r, i) => ({
    id: r.id as string,
    title: r.title as string,
    slug: r.slug as string,
    summary: r.summary as string | null,
    pageType: r.page_type as string,
    score: Number(r.similarity),
    matchType: 'semantic' as const,
  }));
}

async function fullTextSearch(
  workspaceId: string,
  query: string,
  limit: number,
): Promise<SearchHit[]> {
  const tsQuery = query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `${t}:*`)
    .join(' & ');

  if (!tsQuery) return [];

  const results = await db.execute(sql`
    SELECT
      id, title, slug, summary, page_type,
      ts_rank(
        to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, '')),
        to_tsquery('english', ${tsQuery})
      ) as rank
    FROM wiki_pages
    WHERE workspace_id = ${workspaceId}
      AND deleted_at IS NULL
      AND to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))
          @@ to_tsquery('english', ${tsQuery})
    ORDER BY rank DESC
    LIMIT ${limit}
  `);

  return (results.rows as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    slug: r.slug as string,
    summary: r.summary as string | null,
    pageType: r.page_type as string,
    score: Number(r.rank),
    matchType: 'fts' as const,
  }));
}

function rrfMerge(
  vectorHits: SearchHit[],
  ftsHits: SearchHit[],
  limit: number,
  k = RRF_K,
): SearchHit[] {
  if (vectorHits.length === 0 && ftsHits.length === 0) return [];
  if (vectorHits.length === 0) return ftsHits.slice(0, limit);
  if (ftsHits.length === 0) return vectorHits.slice(0, limit);

  const scoreMap = new Map<string, { hit: SearchHit; score: number }>();

  vectorHits.forEach((hit, rank) => {
    const rrfScore = 1 / (k + rank + 1);
    scoreMap.set(hit.id, { hit: { ...hit, matchType: 'semantic' }, score: rrfScore });
  });

  ftsHits.forEach((hit, rank) => {
    const rrfScore = 1 / (k + rank + 1);
    const existing = scoreMap.get(hit.id);
    if (existing) {
      existing.score += rrfScore;
      existing.hit.matchType = 'hybrid';
    } else {
      scoreMap.set(hit.id, { hit: { ...hit, matchType: 'fts' }, score: rrfScore });
    }
  });

  return [...scoreMap.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ hit, score }) => ({ ...hit, score }));
}

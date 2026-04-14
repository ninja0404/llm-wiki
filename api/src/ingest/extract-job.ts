import { db } from '../lib/db.js';
import { sources, sourceChunks, sourceExtractions, activityLogs } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { publishMessage } from '../lib/ws.js';
import { splitIntoChunks } from './chunker.js';
import { slugify, mergeEntitiesBySlug } from './slugify.js';
import { invokeStructured, generateEmbedding } from '../llm/invoke.js';
import { extractSchema } from '../llm/schemas.js';
import {
  EXTRACT_SYSTEM,
  buildExtractPrompt,
  EXTRACT_PROMPT_V1,
} from '../llm/prompts.js';
import { defaultConfig, type TenantLLMConfig } from '../llm/provider.js';
import { logger } from '../lib/logger.js';
import { EXTRACT_BATCH_SIZE } from '@llm-wiki/shared';
import { createHash } from 'crypto';

interface ExtractJobData {
  sourceId: string;
  workspaceId: string;
  batchIndex: number;
  traceId: string;
  llmConfig?: TenantLLMConfig;
}

export async function processExtractJob(data: ExtractJobData) {
  const { sourceId, workspaceId, batchIndex, traceId } = data;
  const llmConfig = data.llmConfig ?? defaultConfig;

  const source = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
  });
  if (!source || !source.rawContent) {
    throw new Error(`Source not found or empty: ${sourceId}`);
  }

  const chunks = splitIntoChunks(source.rawContent);
  const totalBatches = Math.ceil(chunks.length / EXTRACT_BATCH_SIZE);

  // Persist source chunks with embeddings
  const savedChunks: { id: string; content: string }[] = [];

  const batchChunks = chunks.slice(
    batchIndex * EXTRACT_BATCH_SIZE,
    (batchIndex + 1) * EXTRACT_BATCH_SIZE,
  );

  for (const chunk of batchChunks) {
    const contentHash = createHash('sha256').update(chunk.content).digest('hex');

    const existing = await db.query.sourceChunks.findFirst({
      where: eq(sourceChunks.contentHash, contentHash),
      columns: { id: true, embedding: true },
    });

    let embedding: number[] | null = null;
    if (existing?.embedding) {
      embedding = existing.embedding;
    } else {
      try {
        embedding = await generateEmbedding(llmConfig, chunk.content);
      } catch (err) {
        logger.warn({ err, chunkIndex: chunk.index }, 'Embedding generation failed, continuing without');
      }
    }

    const [saved] = await db
      .insert(sourceChunks)
      .values({
        sourceId,
        chunkIndex: chunk.index,
        content: chunk.content,
        tokenCount: chunk.tokenEstimate,
        contentHash,
        embedding,
        embeddingModel: embedding ? 'text-embedding-3-small' : null,
      })
      .returning({ id: sourceChunks.id });

    savedChunks.push({ id: saved.id, content: chunk.content });
  }

  // LLM Extract
  const result = await invokeStructured({
    config: llmConfig,
    workspaceId,
    system: EXTRACT_SYSTEM,
    prompt: buildExtractPrompt(savedChunks),
    schema: extractSchema,
    step: 'extract',
    promptVersion: EXTRACT_PROMPT_V1,
    traceId,
    sourceId,
    batchIndex,
  });

  // Slugify + merge
  const entities = result.entities.map((e) => ({
    ...e,
    slug: slugify(e.name),
  }));
  const merged = mergeEntitiesBySlug(entities);

  // Persist entity extractions
  for (const entity of merged) {
    await db.insert(sourceExtractions).values({
      sourceId,
      entityName: entity.name,
      slug: entity.slug,
      entityType: entity.type,
      description: entity.description,
      sourceChunkIds: entity.sourceChunkIds,
      confidence: ((entity as { confidence?: string }).confidence || 'medium') as 'high' | 'medium' | 'low',
      batchIndex,
    });
  }

  // Persist claim extractions
  for (const claim of result.claims) {
    const claimSlug = slugify(claim.statement.slice(0, 50));
    await db.insert(sourceExtractions).values({
      sourceId,
      entityName: claim.statement.slice(0, 100),
      slug: claimSlug,
      entityType: 'concept',
      description: claim.statement,
      sourceChunkIds: claim.sourceChunkIds,
      confidence: claim.confidence as 'high' | 'medium' | 'low',
      batchIndex,
    });
  }

  // Update ingest state
  await db
    .update(sources)
    .set({
      status: 'processing',
      ingestState: {
        totalBatches,
        completedBatches: batchIndex + 1,
        failedBatches: [],
      },
      updatedAt: new Date(),
    })
    .where(eq(sources.id, sourceId));

  // Activity log
  await db.insert(activityLogs).values({
    workspaceId,
    action: 'extract_batch_completed',
    entityType: 'source',
    entityId: sourceId,
    traceId,
    details: { batchIndex, entities: merged.length, claims: result.claims.length },
  });

  // WebSocket progress push
  await publishMessage(workspaceId, {
    type: 'ingest:progress',
    payload: {
      sourceId,
      totalBatches,
      completedBatches: batchIndex + 1,
      failedBatches: [],
      status: 'processing',
    },
  });

  logger.info(
    { sourceId, batchIndex, entities: merged.length, claims: result.claims.length },
    'Extract batch completed',
  );

  return { entities: merged, claims: result.claims, totalBatches };
}

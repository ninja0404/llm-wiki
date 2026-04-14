import { Hono } from 'hono';
import { db } from '../lib/db.js';
import { sources, workspaces, wikiPageChunks, sourceChunks, wikiPages, activityLogs } from '../db/schema/index.js';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { publishMessage } from '../lib/ws.js';
import { createHash } from 'crypto';
import { validateUrl, fetchUrl, SsrfError } from '../lib/ssrf.js';
import { uploadFile } from '../lib/storage.js';
import { parseFile, UnsupportedFileTypeError } from '../ingest/file-parser.js';
import { splitIntoChunks } from '../ingest/chunker.js';
import { ingestQueue } from '../jobs/queues.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { EXTRACT_BATCH_SIZE, TENANT_MAX_CONCURRENT_INGEST } from '@llm-wiki/shared';

const app = new Hono();

app.get('/', async (c) => {
  const workspaceId = c.req.param('workspaceId')!;
  const result = await db.query.sources.findMany({
    where: eq(sources.workspaceId, workspaceId),
    orderBy: (s, { desc }) => [desc(s.createdAt)],
  });
  return c.json({ data: result });
});

app.post('/text', async (c) => {
  const workspaceId = c.req.param('workspaceId')!;
  const body = await c.req.json<{ title: string; content: string }>();

  const contentHash = createHash('sha256').update(body.content).digest('hex');

  const dup = await checkDuplicate(workspaceId, contentHash);
  if (dup) return c.json(dup, 409);

  const source = await createSource(workspaceId, {
    title: body.title,
    sourceType: 'text',
    rawContent: body.content,
    contentHash,
  });

  return c.json({ data: source }, 201);
});

app.post('/url', async (c) => {
  const workspaceId = c.req.param('workspaceId')!;
  const body = await c.req.json<{ title: string; url: string }>();

  try {
    await validateUrl(body.url);
  } catch (err) {
    if (err instanceof SsrfError) {
      return c.json({ error: 'Forbidden', message: err.message }, 403);
    }
    throw err;
  }

  let rawContent: string;
  try {
    rawContent = await fetchUrl(body.url);
  } catch (err) {
    return c.json(
      { error: 'FetchFailed', message: err instanceof Error ? err.message : 'Failed to fetch URL' },
      422,
    );
  }

  const contentHash = createHash('sha256').update(rawContent).digest('hex');

  const dup = await checkDuplicate(workspaceId, contentHash);
  if (dup) return c.json(dup, 409);

  const source = await createSource(workspaceId, {
    title: body.title,
    sourceType: 'url',
    rawContent,
    url: body.url,
    contentHash,
  });

  return c.json({ data: source }, 201);
});

app.post('/file', async (c) => {
  const workspaceId = c.req.param('workspaceId')!;
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  const title = formData.get('title') as string | null;

  if (!file) return c.json({ error: 'Missing file' }, 400);
  if (!title) return c.json({ error: 'Missing title' }, 400);

  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  if (file.size > MAX_FILE_SIZE) {
    return c.json({ error: 'File too large', message: 'Maximum file size is 10MB' }, 413);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || 'application/octet-stream';

  let rawContent: string;
  try {
    rawContent = await parseFile(buffer, mimeType);
  } catch (err) {
    if (err instanceof UnsupportedFileTypeError) {
      return c.json({ error: 'UnsupportedFileType', message: err.message }, 422);
    }
    return c.json({ error: 'ParseFailed', message: err instanceof Error ? err.message : 'Failed to parse file' }, 422);
  }

  if (!rawContent.trim()) {
    return c.json({ error: 'EmptyContent', message: 'No text content could be extracted from the file' }, 422);
  }

  const contentHash = createHash('sha256').update(rawContent).digest('hex');

  const dup = await checkDuplicate(workspaceId, contentHash);
  if (dup) return c.json(dup, 409);

  let fileKey: string | undefined;
  try {
    fileKey = `${workspaceId}/${crypto.randomUUID()}/${file.name}`;
    await uploadFile(fileKey, buffer, mimeType);
  } catch {
    fileKey = undefined;
  }

  const source = await createSource(workspaceId, {
    title,
    sourceType: 'file',
    rawContent,
    fileKey,
    contentHash,
  });

  return c.json({ data: source }, 201);
});

app.get('/:id', async (c) => {
  const id = c.req.param('id')!;
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, id),
  });

  if (!source) return c.json({ error: 'Not found' }, 404);
  return c.json({ data: source });
});

app.delete('/:id', async (c) => {
  const workspaceId = c.req.param('workspaceId')!;
  const id = c.req.param('id')!;

  const source = await db.query.sources.findFirst({
    where: and(eq(sources.id, id), eq(sources.workspaceId, workspaceId)),
  });
  if (!source) return c.json({ error: 'Not found' }, 404);

  const chunks = await db.query.sourceChunks.findMany({
    where: eq(sourceChunks.sourceId, id),
    columns: { id: true },
  });
  const chunkIds = chunks.map((c) => c.id);

  let affectedPageIds: string[] = [];
  if (chunkIds.length > 0) {
    const pageChunks = await db
      .selectDistinct({ wikiPageId: wikiPageChunks.wikiPageId })
      .from(wikiPageChunks)
      .where(inArray(wikiPageChunks.sourceChunkId, chunkIds));

    affectedPageIds = pageChunks.map((r) => r.wikiPageId);

    if (affectedPageIds.length > 0) {
      await db
        .update(wikiPages)
        .set({ status: 'flagged', updatedAt: new Date() })
        .where(inArray(wikiPages.id, affectedPageIds));
    }
  }

  await db.delete(sources).where(eq(sources.id, id));

  await db.insert(activityLogs).values({
    workspaceId,
    action: 'source_revoked',
    entityType: 'source',
    entityId: id,
    details: { title: source.title, affectedPages: affectedPageIds.length },
  });

  if (affectedPageIds.length > 0) {
    await publishMessage(workspaceId, {
      type: 'flagged:alert',
      payload: { workspaceId, pendingCount: affectedPageIds.length },
    });
  }

  return c.json({ data: { deleted: true, affectedPages: affectedPageIds.length } });
});

async function checkDuplicate(workspaceId: string, contentHash: string) {
  const existing = await db.query.sources.findFirst({
    where: and(
      eq(sources.workspaceId, workspaceId),
      eq(sources.contentHash, contentHash),
    ),
  });
  if (existing) {
    return {
      error: 'Duplicate',
      message: 'A source with identical content already exists',
      existingId: existing.id,
    };
  }
  return null;
}

async function createSource(
  workspaceId: string,
  data: {
    title: string;
    sourceType: 'text' | 'url' | 'file';
    rawContent: string;
    url?: string;
    fileKey?: string;
    contentHash: string;
  },
) {
  // Tenant-level concurrency limit
  const ws = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
    columns: { organizationId: true },
  });
  if (ws) {
    const key = `tenant:${ws.organizationId}:ingest:active`;
    const active = await redis.incr(key);
    await redis.expire(key, 300);
    if (active > TENANT_MAX_CONCURRENT_INGEST) {
      await redis.decr(key);
      throw new Error('Concurrent ingest limit reached');
    }
  }

  const traceId = crypto.randomUUID();
  const chunks = splitIntoChunks(data.rawContent);
  const totalBatches = Math.ceil(chunks.length / EXTRACT_BATCH_SIZE);

  const [source] = await db
    .insert(sources)
    .values({
      workspaceId,
      title: data.title,
      sourceType: data.sourceType,
      rawContent: data.rawContent,
      url: data.url,
      fileKey: data.fileKey,
      contentHash: data.contentHash,
      traceId,
      status: 'pending',
      ingestState: {
        totalBatches,
        completedBatches: 0,
        failedBatches: [],
      },
    })
    .returning();

  await ingestQueue.add(
    'extract-batch',
    { sourceId: source.id, workspaceId, batchIndex: 0, traceId, totalBatches },
    { jobId: `extract-${source.id}-0` },
  );

  logger.info({ sourceId: source.id, totalBatches, traceId }, 'Ingest jobs enqueued');
  return source;
}

export default app;

import { Hono } from 'hono';
import { db } from '../lib/db.js';
import { sources } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { ingestQueue } from '../jobs/queues.js';
import { logger } from '../lib/logger.js';

const app = new Hono();

app.post('/:id/retry', async (c) => {
  const id = c.req.param('id')!;
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, id),
  });

  if (!source) return c.json({ error: 'Not found' }, 404);
  if (source.status !== 'partial_failure' && source.status !== 'failed') {
    return c.json({ error: 'Source is not in a failed state' }, 400);
  }

  const state = source.ingestState as {
    totalBatches: number;
    completedBatches: number;
    failedBatches: number[];
  } | null;

  if (!state || state.failedBatches.length === 0) {
    return c.json({ error: 'No failed batches to retry' }, 400);
  }

  const traceId = crypto.randomUUID();

  for (const batchIndex of state.failedBatches) {
    await ingestQueue.add(
      'extract-batch',
      {
        sourceId: source.id,
        workspaceId: source.workspaceId,
        batchIndex,
        traceId,
        totalBatches: state.totalBatches,
      },
      { jobId: `extract-retry-${source.id}-${batchIndex}-${Date.now()}` },
    );
  }

  await db
    .update(sources)
    .set({
      status: 'processing',
      ingestState: { ...state, failedBatches: [] },
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(sources.id, id));

  logger.info({ sourceId: id, retrying: state.failedBatches }, 'Retrying failed batches');

  return c.json({ data: { retried: state.failedBatches.length } });
});

export default app;

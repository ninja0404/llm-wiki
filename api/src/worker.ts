import { Worker } from 'bullmq';
import { redis } from './lib/redis.js';
import { logger } from './lib/logger.js';
import { processExtractJob } from './ingest/extract-job.js';
import { processBuildWikiJob } from './ingest/build-wiki-job.js';
import { processLintJob } from './lint/lint-job.js';
import { generateEmbedding, CircuitBreakerOpenError } from './llm/invoke.js';
import { defaultConfig } from './llm/provider.js';
import { CIRCUIT_BREAKER_TTL_S } from '@llm-wiki/shared';
import { db } from './lib/db.js';
import { sources, wikiPages, workspaces } from './db/schema/index.js';
import { eq } from 'drizzle-orm';
import { ingestQueue, embeddingQueue } from './jobs/queues.js';

async function decrTenantIngest(sourceId: string) {
  try {
    const source = await db.query.sources.findFirst({
      where: eq(sources.id, sourceId),
      columns: { workspaceId: true },
    });
    if (!source) return;
    const ws = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, source.workspaceId),
      columns: { organizationId: true },
    });
    if (ws) {
      await redis.decr(`tenant:${ws.organizationId}:ingest:active`);
    }
  } catch { /* non-critical */ }
}

const connection = { connection: redis };

// ── Workers ──

const ingestWorker = new Worker(
  'ingest',
  async (job) => {
    logger.info({ jobId: job.id, name: job.name }, 'Processing ingest job');

    switch (job.name) {
      case 'extract-batch': {
        let result;
        try {
          result = await processExtractJob(job.data);
        } catch (err) {
          if (err instanceof CircuitBreakerOpenError) {
            logger.warn({ provider: err.provider }, 'Circuit breaker open, delaying job 10 min');
            await job.moveToDelayed(Date.now() + CIRCUIT_BREAKER_TTL_S * 1000, job.token);
            return;
          }
          throw err;
        }

        const { sourceId, workspaceId, traceId, totalBatches } = job.data;
        const batchIndex = job.data.batchIndex as number;
        if (result && batchIndex + 1 >= totalBatches) {
          logger.info({ sourceId }, 'All extract batches done, enqueuing build-wiki');
          await ingestQueue.add(
            'build-wiki',
            { sourceId, workspaceId, traceId },
            { jobId: `build-wiki-${sourceId}` },
          );
        }
        return result;
      }

      case 'build-wiki':
        return processBuildWikiJob(job.data);

      default:
        logger.warn({ name: job.name }, 'Unknown ingest job type');
    }
  },
  {
    ...connection,
    concurrency: 3,
    limiter: { max: 10, duration: 60_000 },
  },
);

const embeddingWorker = new Worker(
  'embedding-update',
  async (job) => {
    const { pageId } = job.data;
    logger.info({ jobId: job.id, pageId }, 'Processing embedding update');

    const page = await db.query.wikiPages.findFirst({
      where: eq(wikiPages.id, pageId),
      columns: { id: true, title: true, summary: true, content: true },
    });
    if (!page) return;

    const textForEmbedding = `${page.title}\n${page.summary || ''}\n${page.content.slice(0, 500)}`;
    const embedding = await generateEmbedding(defaultConfig, textForEmbedding);

    await db
      .update(wikiPages)
      .set({
        embedding,
        embeddingModel: 'text-embedding-3-small',
        updatedAt: new Date(),
      })
      .where(eq(wikiPages.id, pageId));

    logger.info({ pageId }, 'Embedding updated');
  },
  {
    ...connection,
    concurrency: 5,
  },
);

const lintWorker = new Worker(
  'lint',
  async (job) => {
    logger.info({ jobId: job.id }, 'Processing lint job');
    return processLintJob(job.data);
  },
  {
    ...connection,
    concurrency: 1,
  },
);

// ── Lifecycle ──

function setupGracefulShutdown(workers: Worker[]) {
  const shutdown = async () => {
    logger.info('Shutting down workers...');
    await Promise.all(workers.map((w) => w.close()));
    await redis.quit();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

async function start() {
  logger.info('Worker process started');

  setInterval(async () => {
    try {
      await redis.set('worker:heartbeat', String(Date.now()), 'EX', 60);
    } catch { /* non-critical */ }
    logger.debug({ uptime: process.uptime() }, 'Worker heartbeat');
  }, 30_000);

  setupGracefulShutdown([ingestWorker, embeddingWorker, lintWorker]);

  ingestWorker.on('completed', async (job) => {
    logger.info({ jobId: job.id, name: job.name }, 'Job completed');
    if (job.name === 'build-wiki' && job.data?.sourceId) {
      await decrTenantIngest(job.data.sourceId);
    }
  });
  ingestWorker.on('failed', async (job, err) => {
    logger.error({ jobId: job?.id, name: job?.name, err }, 'Job failed');

    if (job?.name === 'extract-batch' && job.data) {
      const { sourceId, batchIndex } = job.data;
      try {
        const source = await db.query.sources.findFirst({
          where: eq(sources.id, sourceId),
          columns: { ingestState: true },
        });
        const state = source?.ingestState as { totalBatches: number; completedBatches: number; failedBatches: number[] } | null;
        if (state) {
          const failedBatches = [...new Set([...(state.failedBatches || []), batchIndex])];
          await db.update(sources).set({
            status: 'partial_failure',
            ingestState: { ...state, failedBatches },
            errorMessage: err.message,
            updatedAt: new Date(),
          }).where(eq(sources.id, sourceId));
        }
      } catch { /* non-critical */ }
    }

    if ((job?.name === 'build-wiki' || job?.name === 'extract-batch') && job?.data?.sourceId) {
      await decrTenantIngest(job.data.sourceId);
    }
  });

  for (const worker of [embeddingWorker, lintWorker]) {
    worker.on('completed', (job) => {
      logger.info({ jobId: job.id, name: job.name }, 'Job completed');
    });
    worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, name: job?.name, err }, 'Job failed');
    });
  }
}

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start workers');
  process.exit(1);
});

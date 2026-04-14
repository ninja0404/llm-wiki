import { Queue } from 'bullmq';
import { redis } from '../lib/redis.js';

const connection = { connection: redis };

export const ingestQueue = new Queue('ingest', {
  ...connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

export const queryQueue = new Queue('query', {
  ...connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

export const lintQueue = new Queue('lint', {
  ...connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

export const embeddingQueue = new Queue('embedding-update', {
  ...connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

export const embeddingMigrateQueue = new Queue('embedding-migrate', {
  ...connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

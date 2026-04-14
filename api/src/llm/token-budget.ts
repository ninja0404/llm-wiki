import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

const BUDGET_KEY = (workspaceId: string) => {
  const period = new Date().toISOString().slice(0, 7).replace('-', '');
  return `budget:${workspaceId}:${period}`;
};

export async function reserveTokens(
  workspaceId: string,
  estimatedTokens: number,
  monthlyBudget: number,
): Promise<boolean> {
  try {
    const key = BUDGET_KEY(workspaceId);
    const current = await redis.incrby(key, estimatedTokens);

    if (!await redis.ttl(key).then((ttl) => ttl > 0)) {
      const now = new Date();
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const ttlSeconds = Math.ceil((endOfMonth.getTime() - now.getTime()) / 1000);
      await redis.expire(key, ttlSeconds);
    }

    if (current > monthlyBudget) {
      await redis.decrby(key, estimatedTokens);
      logger.warn({ workspaceId, current, budget: monthlyBudget }, 'Token budget exceeded');
      return false;
    }

    return true;
  } catch {
    return true;
  }
}

export async function adjustTokens(
  workspaceId: string,
  estimated: number,
  actual: number,
): Promise<void> {
  try {
    const diff = estimated - actual;
    if (diff !== 0) {
      const key = BUDGET_KEY(workspaceId);
      if (diff > 0) {
        await redis.decrby(key, diff);
      } else {
        await redis.incrby(key, Math.abs(diff));
      }
    }
  } catch {
    // non-critical
  }
}

const INGEST_BUDGET_KEY = (sourceId: string) => `ingest-budget:${sourceId}`;

export async function reserveIngestTokens(
  sourceId: string,
  estimatedTokens: number,
  perIngestBudget: number,
): Promise<boolean> {
  try {
    const key = INGEST_BUDGET_KEY(sourceId);
    const current = await redis.incrby(key, estimatedTokens);
    await redis.expire(key, 3600);

    if (current > perIngestBudget) {
      await redis.decrby(key, estimatedTokens);
      logger.warn({ sourceId, current, budget: perIngestBudget }, 'Per-ingest token budget exceeded');
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

export async function getCurrentUsage(workspaceId: string): Promise<number> {
  try {
    const key = BUDGET_KEY(workspaceId);
    const val = await redis.get(key);
    return val ? parseInt(val, 10) : 0;
  } catch {
    return 0;
  }
}

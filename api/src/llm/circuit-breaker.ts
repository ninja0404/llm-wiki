import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import {
  CIRCUIT_BREAKER_THRESHOLD,
  CIRCUIT_BREAKER_TTL_S,
} from '@llm-wiki/shared';

const FAILURE_KEY = (provider: string) => `circuit:${provider}:failures`;
const OPEN_KEY = (provider: string) => `circuit:${provider}:open`;

export async function isCircuitOpen(provider: string): Promise<boolean> {
  try {
    const open = await redis.get(OPEN_KEY(provider));
    return open === '1';
  } catch {
    return false;
  }
}

export async function recordFailure(provider: string): Promise<boolean> {
  try {
    const key = FAILURE_KEY(provider);
    const count = await redis.incr(key);
    await redis.expire(key, CIRCUIT_BREAKER_TTL_S);

    if (count >= CIRCUIT_BREAKER_THRESHOLD) {
      await redis.set(OPEN_KEY(provider), '1', 'EX', CIRCUIT_BREAKER_TTL_S);
      logger.warn({ provider, count }, 'Circuit breaker OPEN');
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function recordSuccess(provider: string): Promise<void> {
  try {
    await redis.del(FAILURE_KEY(provider));
    await redis.del(OPEN_KEY(provider));
  } catch {
    // non-critical
  }
}

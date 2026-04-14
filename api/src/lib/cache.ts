import { redis } from './redis.js';
import { logger } from './logger.js';

const DEFAULT_TTL_S = 300;

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const val = await redis.get(key);
    return val ? JSON.parse(val) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = DEFAULT_TTL_S): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    // cache-aside: silently fail
  }
}

export async function cacheInvalidate(key: string): Promise<void> {
  try {
    await redis.del(key);
  } catch {
    // non-critical
  }
}

export async function cacheInvalidatePattern(pattern: string): Promise<void> {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch {
    // non-critical
  }
}

export const CACHE_KEYS = {
  wikiPage: (workspaceId: string, slug: string) => `cache:wiki:${workspaceId}:${slug}`,
  wikiList: (workspaceId: string) => `cache:wiki-list:${workspaceId}`,
  queryResult: (workspaceId: string, queryHash: string) => `cache:query:${workspaceId}:${queryHash}`,
} as const;

import { redis } from './redis.js';
import { logger } from './logger.js';
import type { Context, Next } from 'hono';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}

async function checkRateLimit(key: string, windowMs: number, maxRequests: number): Promise<{ allowed: boolean; remaining: number; resetMs: number }> {
  try {
    const now = Date.now();
    const windowKey = `ratelimit:${key}:${Math.floor(now / windowMs)}`;

    const current = await redis.incr(windowKey);
    if (current === 1) {
      await redis.pexpire(windowKey, windowMs);
    }

    const remaining = Math.max(0, maxRequests - current);
    const resetMs = windowMs - (now % windowMs);

    return { allowed: current <= maxRequests, remaining, resetMs };
  } catch {
    return { allowed: true, remaining: maxRequests, resetMs: 0 };
  }
}

export function globalRateLimit(config: RateLimitConfig) {
  return async (c: Context, next: Next) => {
    const key = `${config.keyPrefix}:global`;
    const result = await checkRateLimit(key, config.windowMs, config.maxRequests);

    c.header('X-RateLimit-Limit', String(config.maxRequests));
    c.header('X-RateLimit-Remaining', String(result.remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil(result.resetMs / 1000)));

    if (!result.allowed) {
      logger.warn({ key }, 'Global rate limit exceeded');
      return c.json({ error: 'Too Many Requests', message: 'Global rate limit exceeded' }, 429);
    }

    await next();
  };
}

export function tenantRateLimit(config: RateLimitConfig) {
  return async (c: Context, next: Next) => {
    const userId = c.get('userId' as never) as string | undefined;
    if (!userId) {
      await next();
      return;
    }

    const key = `${config.keyPrefix}:tenant:${userId}`;
    const result = await checkRateLimit(key, config.windowMs, config.maxRequests);

    c.header('X-RateLimit-Limit', String(config.maxRequests));
    c.header('X-RateLimit-Remaining', String(result.remaining));

    if (!result.allowed) {
      logger.warn({ key, userId }, 'Tenant rate limit exceeded');
      return c.json({ error: 'Too Many Requests', message: 'Rate limit exceeded for your account' }, 429);
    }

    await next();
  };
}

export function endpointRateLimit(config: RateLimitConfig) {
  return async (c: Context, next: Next) => {
    const userId = c.get('userId' as never) as string | undefined;
    const path = c.req.path;
    const key = `${config.keyPrefix}:ep:${userId || 'anon'}:${path}`;
    const result = await checkRateLimit(key, config.windowMs, config.maxRequests);

    if (!result.allowed) {
      logger.warn({ key, path }, 'Endpoint rate limit exceeded');
      return c.json({ error: 'Too Many Requests', message: 'Rate limit exceeded for this endpoint' }, 429);
    }

    await next();
  };
}

export const RATE_LIMITS = {
  global: { windowMs: 60_000, maxRequests: 1000, keyPrefix: 'rl' },
  tenant: { windowMs: 60_000, maxRequests: 200, keyPrefix: 'rl' },
  llmEndpoints: { windowMs: 60_000, maxRequests: 30, keyPrefix: 'rl' },
} as const;

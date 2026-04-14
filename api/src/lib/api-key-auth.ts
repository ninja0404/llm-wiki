import { createHash } from 'crypto';
import { randomBytes } from 'crypto';
import { db } from './db.js';
import { apiKeys } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import type { Context, Next } from 'hono';
import { auth } from './auth.js';

const API_KEY_PREFIX = 'sk-';

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const raw = randomBytes(32).toString('hex');
  const key = `${API_KEY_PREFIX}${raw}`;
  const hash = createHash('sha256').update(key).digest('hex');
  const prefix = key.slice(0, 10);
  return { key, hash, prefix };
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export async function apiKeyOrSessionAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (authHeader?.startsWith('Bearer sk-')) {
    const key = authHeader.slice(7);
    const hash = hashApiKey(key);

    const apiKey = await db.query.apiKeys.findFirst({
      where: and(
        eq(apiKeys.keyHash, hash),
        isNull(apiKeys.revokedAt),
      ),
    });

    if (!apiKey) {
      return c.json({ error: 'Invalid API key' }, 401);
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return c.json({ error: 'API key expired' }, 401);
    }

    await db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, apiKey.id));

    c.set('userId' as never, apiKey.organizationId);
    c.set('apiKeyScope' as never, apiKey.scope);
    c.set('isApiKey' as never, true);

    await next();
    return;
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('userId' as never, session.user.id);
  c.set('apiKeyScope' as never, 'admin');
  c.set('isApiKey' as never, false);

  await next();
}

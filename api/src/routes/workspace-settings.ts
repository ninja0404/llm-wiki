import { Hono } from 'hono';
import { db } from '../lib/db.js';
import { workspaces } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { encrypt, decrypt } from '../lib/crypto.js';

const app = new Hono();

app.get('/llm-config', async (c) => {
  const workspaceId = c.req.param('workspaceId')!;
  const ws = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
    columns: {
      llmProvider: true,
      llmModel: true,
      llmBaseUrl: true,
      llmFallbackProvider: true,
      llmFallbackModel: true,
      llmFallbackBaseUrl: true,
    },
  });

  if (!ws) return c.json({ error: 'Not found' }, 404);

  return c.json({
    data: {
      primary: {
        provider: ws.llmProvider || 'openai',
        model: ws.llmModel || 'gpt-4o-mini',
        baseUrl: ws.llmBaseUrl,
        hasApiKey: !!ws.llmProvider,
      },
      fallback: ws.llmFallbackProvider ? {
        provider: ws.llmFallbackProvider,
        model: ws.llmFallbackModel,
        baseUrl: ws.llmFallbackBaseUrl,
        hasApiKey: true,
      } : null,
    },
  });
});

app.put('/llm-config', async (c) => {
  const workspaceId = c.req.param('workspaceId')!;
  const body = await c.req.json<{
    provider?: string;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    fallbackProvider?: string;
    fallbackModel?: string;
    fallbackApiKey?: string;
    fallbackBaseUrl?: string;
  }>();

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.provider) updates.llmProvider = body.provider;
  if (body.model) updates.llmModel = body.model;
  if (body.baseUrl !== undefined) updates.llmBaseUrl = body.baseUrl || null;
  if (body.apiKey) updates.llmApiKeyEncrypted = encrypt(body.apiKey);

  if (body.fallbackProvider) updates.llmFallbackProvider = body.fallbackProvider;
  if (body.fallbackModel) updates.llmFallbackModel = body.fallbackModel;
  if (body.fallbackBaseUrl !== undefined) updates.llmFallbackBaseUrl = body.fallbackBaseUrl || null;
  if (body.fallbackApiKey) updates.llmFallbackApiKeyEncrypted = encrypt(body.fallbackApiKey);

  await db.update(workspaces).set(updates).where(eq(workspaces.id, workspaceId));

  return c.json({ data: { updated: true } });
});

app.delete('/llm-config/fallback', async (c) => {
  const workspaceId = c.req.param('workspaceId')!;

  await db.update(workspaces).set({
    llmFallbackProvider: null,
    llmFallbackModel: null,
    llmFallbackApiKeyEncrypted: null,
    llmFallbackBaseUrl: null,
    updatedAt: new Date(),
  }).where(eq(workspaces.id, workspaceId));

  return c.json({ data: { removed: true } });
});

export default app;

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { auth } from './lib/auth.js';
import { logger } from './lib/logger.js';
import { config } from './lib/config.js';
import {
  addToRoom,
  removeFromRoom,
  subscribeToWorkspace,
  unsubscribeFromWorkspace,
  initWsSubscriber,
} from './lib/ws.js';
import { globalRateLimit, tenantRateLimit, endpointRateLimit, RATE_LIMITS } from './lib/rate-limit.js';
import { httpRequestDuration, httpRequestTotal } from './lib/metrics.js';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/dist/queueAdapters/bullMQ.js';
import { HonoAdapter } from '@bull-board/hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { ingestQueue, embeddingQueue, queryQueue, lintQueue } from './jobs/queues.js';
import { db } from './lib/db.js';
import { workspaces, members } from './db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import healthRoutes from './routes/health.js';
import meRoutes from './routes/me.js';
import workspaceRoutes from './routes/workspaces.js';
import sourceRoutes from './routes/sources.js';
import sourceRetryRoutes from './routes/sources-retry.js';
import wikiRoutes from './routes/wiki.js';
import searchRoutes from './routes/search.js';
import dashboardRoutes from './routes/dashboard.js';
import activityRoutes from './routes/activity.js';
import chatRoutes from './routes/chat.js';
import flaggedRoutes from './routes/flagged.js';
import lintRoutes from './routes/lint.js';
import apiKeysRoutes from './routes/api-keys.js';
import ssoRoutes from './routes/sso.js';
import billingRoutes from './routes/billing.js';
import { apiReference } from '@scalar/hono-api-reference';

const app = new Hono();

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// ── Middleware ──

app.use('*', cors({
  origin: config.corsOrigins,
  credentials: true,
}));

if (config.nodeEnv !== 'production') {
  app.use('*', honoLogger());
}

app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const duration = (Date.now() - start) / 1000;
  const route = c.req.routePath || c.req.path;
  const labels = { method: c.req.method, route, status_code: String(c.res.status) };
  httpRequestDuration.observe(labels, duration);
  httpRequestTotal.inc(labels);
});

// ── Bull Board (auth protected) ──

app.use('/bull/*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  await next();
});

const serverAdapter = new HonoAdapter(serveStatic);
serverAdapter.setBasePath('/bull');
createBullBoard({
  queues: [
    new BullMQAdapter(ingestQueue),
    new BullMQAdapter(queryQueue),
    new BullMQAdapter(lintQueue),
    new BullMQAdapter(embeddingQueue),
  ],
  serverAdapter,
});
app.route('/bull', serverAdapter.registerPlugin());

// ── Public routes ──

app.route('/', healthRoutes);

import metricsRoutes from './routes/metrics.js';
app.route('/', metricsRoutes);

import openapiRoutes from './routes/openapi.js';
app.route('/api', openapiRoutes);

app.on(['POST', 'GET'], '/api/auth/**', (c) => auth.handler(c.req.raw));

// ── WebSocket ──

app.get(
  '/ws',
  upgradeWebSocket(async (c) => {
    const url = new URL(c.req.url);
    const workspaceId = url.searchParams.get('workspaceId');
    const token = url.searchParams.get('token');

    let userId = 'anonymous';
    if (token) {
      try {
        const session = await auth.api.getSession({ headers: new Headers({ cookie: `better-auth.session_token=${token}` }) });
        if (session) userId = session.user.id;
      } catch {
        // proceed as anonymous for now
      }
    }

    return {
      onOpen(_evt, ws) {
        if (workspaceId) {
          const client = { ws, userId, workspaceId };
          addToRoom(workspaceId, client);
          subscribeToWorkspace(workspaceId);
          (ws as unknown as { _client: typeof client })._client = client;
        }
        logger.debug({ workspaceId, userId }, 'WS connected');
      },
      onMessage(event, ws) {
        // heartbeat pong
        if (event.data === 'ping') {
          ws.send('pong');
        }
      },
      onClose(_evt, ws) {
        const client = (ws as unknown as { _client?: { userId: string; workspaceId: string } })._client;
        if (client) {
          removeFromRoom(client.workspaceId, { ws, ...client });
          unsubscribeFromWorkspace(client.workspaceId);
        }
        logger.debug('WS disconnected');
      },
    };
  }),
);

// ── Rate limiting ──

app.use('/api/*', globalRateLimit(RATE_LIMITS.global));

// ── Protected routes ──

app.use('/api/*', async (c, next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('userId' as never, session.user.id);
  await next();
});

app.use('/api/*', tenantRateLimit(RATE_LIMITS.tenant));

app.route('/api/me', meRoutes);
app.route('/api/api-keys', apiKeysRoutes);
app.route('/api/sso', ssoRoutes);
app.route('/api/billing', billingRoutes);

app.get('/docs', apiReference({
  theme: 'default',
  spec: { url: '/api/openapi.json' },
}));
app.route('/api/workspaces', workspaceRoutes);

// Workspace-scoped routes with authorization guard
const workspaceScoped = new Hono();

workspaceScoped.use('*', async (c, next) => {
  const userId = c.get('userId' as never) as string;
  const workspaceId = c.req.param('workspaceId');
  if (!workspaceId) return c.json({ error: 'Missing workspaceId' }, 400);

  const ws = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
    columns: { id: true, organizationId: true },
  });
  if (!ws) return c.json({ error: 'Workspace not found' }, 404);

  const member = await db.query.members.findFirst({
    where: and(eq(members.userId, userId), eq(members.organizationId, ws.organizationId)),
  });
  if (!member) return c.json({ error: 'Forbidden' }, 403);

  await next();
});

workspaceScoped.use('/sources*', endpointRateLimit(RATE_LIMITS.llmEndpoints));
workspaceScoped.use('/chat*', endpointRateLimit(RATE_LIMITS.llmEndpoints));

workspaceScoped.route('/sources', sourceRoutes);
workspaceScoped.route('/sources', sourceRetryRoutes);
workspaceScoped.route('/wiki', wikiRoutes);
workspaceScoped.route('/search', searchRoutes);
workspaceScoped.route('/dashboard', dashboardRoutes);
workspaceScoped.route('/activity', activityRoutes);
workspaceScoped.route('/chat', chatRoutes);
workspaceScoped.route('/flagged', flaggedRoutes);
workspaceScoped.route('/lint', lintRoutes);

import exportRoutes from './routes/export.js';
workspaceScoped.route('/export', exportRoutes);

import commentsRoutes from './routes/comments.js';
workspaceScoped.route('/', commentsRoutes);

import workspaceSettingsRoutes from './routes/workspace-settings.js';
workspaceScoped.route('/settings', workspaceSettingsRoutes);

app.route('/api/workspaces/:workspaceId', workspaceScoped);

// ── Start ──

function validateProductionSecrets() {
  if (config.nodeEnv !== 'production') return;

  const issues: string[] = [];

  if (config.betterAuthSecret === 'dev-secret-change-in-production') {
    issues.push('BETTER_AUTH_SECRET is using the default value');
  }
  if (config.encryptionKey === '0'.repeat(64)) {
    issues.push('ENCRYPTION_KEY is using the default zero-filled value');
  }

  if (issues.length > 0) {
    for (const issue of issues) {
      logger.error({ issue }, 'SECURITY: Production secret misconfiguration');
    }
    logger.fatal('Refusing to start with insecure default secrets in production. Set BETTER_AUTH_SECRET and ENCRYPTION_KEY.');
    process.exit(1);
  }
}

async function start() {
  validateProductionSecrets();
  await initWsSubscriber();

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info(`API server running on http://localhost:${info.port}`);
  });

  injectWebSocket(server);
  logger.info('WebSocket server initialized');
}

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});

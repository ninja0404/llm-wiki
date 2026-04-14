import { Hono } from 'hono';

const app = new Hono();

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'LLM Wiki API',
    version: '0.3.0',
    description: 'AI-powered knowledge base that automatically builds and maintains structured wikis',
  },
  servers: [{ url: '/api', description: 'API Server' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', description: 'Session token or API Key (sk-...)' },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/auth/signup': {
      post: { tags: ['Auth'], summary: 'Register', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, password: { type: 'string' }, name: { type: 'string' } } } } } }, responses: { '200': { description: 'Success' } } },
    },
    '/auth/signin': {
      post: { tags: ['Auth'], summary: 'Login', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, password: { type: 'string' } } } } } }, responses: { '200': { description: 'Session created' } } },
    },
    '/me': {
      get: { tags: ['User'], summary: 'Current user + workspaces', responses: { '200': { description: 'User info' } } },
    },
    '/workspaces': {
      get: { tags: ['Workspace'], summary: 'List workspaces', responses: { '200': { description: 'Workspace list' } } },
      post: { tags: ['Workspace'], summary: 'Create workspace', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } } } } } }, responses: { '201': { description: 'Created' } } },
    },
    '/workspaces/{workspaceId}/sources': {
      get: { tags: ['Sources'], summary: 'List sources', parameters: [{ name: 'workspaceId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Source list' } } },
    },
    '/workspaces/{workspaceId}/sources/text': {
      post: { tags: ['Sources'], summary: 'Add text source', parameters: [{ name: 'workspaceId', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' } } } } } }, responses: { '201': { description: 'Created' } } },
    },
    '/workspaces/{workspaceId}/sources/url': {
      post: { tags: ['Sources'], summary: 'Add URL source', parameters: [{ name: 'workspaceId', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' } } } } } }, responses: { '201': { description: 'Created' } } },
    },
    '/workspaces/{workspaceId}/sources/file': {
      post: { tags: ['Sources'], summary: 'Upload file source (PDF/DOCX/HTML)', parameters: [{ name: 'workspaceId', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, title: { type: 'string' } } } } } }, responses: { '201': { description: 'Created' } } },
    },
    '/workspaces/{workspaceId}/wiki': {
      get: { tags: ['Wiki'], summary: 'List wiki pages', parameters: [{ name: 'workspaceId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Page list' } } },
    },
    '/workspaces/{workspaceId}/wiki/by-slug/{slug}': {
      get: { tags: ['Wiki'], summary: 'Get wiki page by slug', parameters: [{ name: 'workspaceId', in: 'path', required: true, schema: { type: 'string' } }, { name: 'slug', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Page detail' } } },
    },
    '/workspaces/{workspaceId}/search': {
      get: { tags: ['Search'], summary: 'Hybrid search (vector + FTS)', parameters: [{ name: 'workspaceId', in: 'path', required: true, schema: { type: 'string' } }, { name: 'q', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Search results' } } },
    },
    '/workspaces/{workspaceId}/chat/conversations/{convId}/chat': {
      post: { tags: ['Chat'], summary: 'RAG chat (streaming SSE)', parameters: [{ name: 'workspaceId', in: 'path', required: true, schema: { type: 'string' } }, { name: 'convId', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } } } } } }, responses: { '200': { description: 'SSE stream' } } },
    },
    '/workspaces/{workspaceId}/export/markdown': {
      get: { tags: ['Export'], summary: 'Export wiki as Markdown ZIP', parameters: [{ name: 'workspaceId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ZIP file' } } },
    },
    '/workspaces/{workspaceId}/lint': {
      post: { tags: ['Lint'], summary: 'Trigger wiki lint check', parameters: [{ name: 'workspaceId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Queued' } } },
    },
    '/api-keys': {
      get: { tags: ['API Keys'], summary: 'List API keys', responses: { '200': { description: 'Key list' } } },
      post: { tags: ['API Keys'], summary: 'Create API key', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, scope: { type: 'string', enum: ['read', 'write', 'admin'] }, organizationId: { type: 'string' } } } } } }, responses: { '201': { description: 'Key created (shown once)' } } },
    },
    '/billing/subscription': {
      get: { tags: ['Billing'], summary: 'Get subscription', responses: { '200': { description: 'Subscription info' } } },
    },
    '/billing/plans': {
      get: { tags: ['Billing'], summary: 'List available plans', responses: { '200': { description: 'Plan list' } } },
    },
    '/sso/register': {
      post: { tags: ['SSO'], summary: 'Register SAML SSO provider', responses: { '201': { description: 'Provider registered' } } },
    },
  },
};

app.get('/openapi.json', (c) => {
  return c.json(spec);
});

export default app;

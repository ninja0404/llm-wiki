import { Hono } from 'hono';
import { auth } from '../lib/auth.js';

const app = new Hono();

app.post('/register', async (c) => {
  const body = await c.req.json<{
    organizationId: string;
    providerId: string;
    type: 'saml';
    entryPoint: string;
    certificate: string;
    callbackUrl?: string;
  }>();

  try {
    const result = await auth.api.registerSSOProvider({
      body: {
        organizationId: body.organizationId,
        providerId: body.providerId,
        type: body.type,
        saml: {
          entryPoint: body.entryPoint,
          cert: body.certificate,
          callbackUrl: body.callbackUrl || `${process.env.BASE_URL || 'http://localhost:3001'}/api/auth/sso/callback`,
        },
      },
    });

    return c.json({ data: result }, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'SSO registration failed' }, 400);
  }
});

app.get('/providers', async (c) => {
  const organizationId = c.req.query('organizationId');
  if (!organizationId) return c.json({ error: 'Missing organizationId' }, 400);

  try {
    const providers = await auth.api.listSSOProviders({
      query: { organizationId },
    });
    return c.json({ data: providers });
  } catch (err) {
    return c.json({ data: [] });
  }
});

export default app;

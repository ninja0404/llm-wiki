import { Hono } from 'hono';
import { db } from '../lib/db.js';
import {
  organizations,
  members,
  workspaces,
} from '../db/schema/index.js';
import { eq } from 'drizzle-orm';

type Env = { Variables: { userId: string } };

const app = new Hono<Env>();

app.get('/', async (c) => {
  const userId = c.get('userId');

  const userOrgs = await db.query.members.findMany({
    where: eq(members.userId, userId),
    with: { organization: true },
  });

  if (userOrgs.length === 0) {
    const [org] = await db
      .insert(organizations)
      .values({ name: 'My Organization', slug: `org-${userId.slice(0, 8).toLowerCase()}` })
      .returning();

    await db.insert(members).values({
      organizationId: org.id,
      userId,
      role: 'owner',
    });

    const [ws] = await db
      .insert(workspaces)
      .values({
        organizationId: org.id,
        name: 'Default Workspace',
        description: 'Your first knowledge space',
      })
      .returning();

    return c.json({
      data: {
        organizations: [{ ...org, role: 'owner' as const }],
        workspaces: [ws],
      },
    });
  }

  const orgIds = userOrgs.map((m) => m.organizationId);
  const allWorkspaces = await db.query.workspaces.findMany({
    where: (w, { inArray }) => inArray(w.organizationId, orgIds),
    orderBy: (w, { desc }) => [desc(w.updatedAt)],
  });

  if (allWorkspaces.length === 0) {
    const firstOrg = userOrgs[0];
    const [ws] = await db
      .insert(workspaces)
      .values({
        organizationId: firstOrg.organizationId,
        name: 'Default Workspace',
        description: 'Your first knowledge space',
      })
      .returning();
    allWorkspaces.push(ws);
  }

  return c.json({
    data: {
      organizations: userOrgs.map((m) => ({
        ...m.organization,
        role: m.role,
      })),
      workspaces: allWorkspaces,
    },
  });
});

export default app;

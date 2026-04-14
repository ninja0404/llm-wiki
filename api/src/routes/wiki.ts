import { Hono } from 'hono';
import { db } from '../lib/db.js';
import { wikiPages, wikiLinks, wikiPageChunks, wikiPageVersions, sourceChunks, sources } from '../db/schema/index.js';
import { eq, and, isNull, sql, inArray, desc } from 'drizzle-orm';

const app = new Hono();

app.get('/', async (c) => {
  const workspaceId = c.req.param('workspaceId')!;
  const result = await db.query.wikiPages.findMany({
    where: and(
      eq(wikiPages.workspaceId, workspaceId),
      isNull(wikiPages.deletedAt),
    ),
    columns: {
      id: true,
      title: true,
      slug: true,
      summary: true,
      pageType: true,
      status: true,
      tags: true,
      confidence: true,
      updatedAt: true,
    },
    orderBy: (w, { desc }) => [desc(w.updatedAt)],
  });
  return c.json({ data: result });
});

app.get('/by-slug/:slug', async (c) => {
  const workspaceId = c.req.param('workspaceId')!;
  const slug = c.req.param('slug')!;

  const page = await db.query.wikiPages.findFirst({
    where: and(
      eq(wikiPages.workspaceId, workspaceId),
      eq(wikiPages.slug, slug),
      isNull(wikiPages.deletedAt),
    ),
  });

  if (!page) return c.json({ error: 'Not found' }, 404);

  const outgoing = await db.query.wikiLinks.findMany({
    where: eq(wikiLinks.sourcePageId, page.id),
    with: { targetPage: { columns: { id: true, title: true, slug: true } } },
  });
  const incoming = await db.query.wikiLinks.findMany({
    where: eq(wikiLinks.targetPageId, page.id),
    with: { sourcePage: { columns: { id: true, title: true, slug: true } } },
  });

  // Source attribution: which sources contributed to this page
  const pageChunks = await db.query.wikiPageChunks.findMany({
    where: eq(wikiPageChunks.wikiPageId, page.id),
    columns: { sourceChunkId: true },
  });
  const chunkIds = pageChunks.map((pc) => pc.sourceChunkId);
  let pageSources: { id: string; title: string }[] = [];
  if (chunkIds.length > 0) {
    const chunks = await db
      .selectDistinct({ sourceId: sourceChunks.sourceId })
      .from(sourceChunks)
      .where(inArray(sourceChunks.id, chunkIds));
    const sourceIds = chunks.map((c) => c.sourceId);
    if (sourceIds.length > 0) {
      pageSources = await db.query.sources.findMany({
        where: inArray(sources.id, sourceIds),
        columns: { id: true, title: true },
      });
    }
  }

  return c.json({
    data: {
      ...page,
      sources: pageSources,
      links: outgoing.map((l) => l.targetPage),
      backlinks: incoming.map((l) => l.sourcePage),
    },
  });
});

app.get('/graph', async (c) => {
  const workspaceId = c.req.param('workspaceId')!;

  const pages = await db.query.wikiPages.findMany({
    where: and(
      eq(wikiPages.workspaceId, workspaceId),
      isNull(wikiPages.deletedAt),
    ),
    columns: { id: true, title: true, slug: true, pageType: true },
  });

  const links = await db
    .select({
      source: wikiLinks.sourcePageId,
      target: wikiLinks.targetPageId,
    })
    .from(wikiLinks)
    .innerJoin(wikiPages, eq(wikiLinks.sourcePageId, wikiPages.id))
    .where(eq(wikiPages.workspaceId, workspaceId));

  const linkCountMap = new Map<string, number>();
  for (const link of links) {
    linkCountMap.set(link.source, (linkCountMap.get(link.source) || 0) + 1);
    linkCountMap.set(link.target, (linkCountMap.get(link.target) || 0) + 1);
  }

  return c.json({
    data: {
      nodes: pages.map((p) => ({
        ...p,
        linkCount: linkCountMap.get(p.id) || 0,
      })),
      links,
    },
  });
});

app.get('/by-slug/:slug/versions', async (c) => {
  const workspaceId = c.req.param('workspaceId')!;
  const slug = c.req.param('slug')!;

  const page = await db.query.wikiPages.findFirst({
    where: and(
      eq(wikiPages.workspaceId, workspaceId),
      eq(wikiPages.slug, slug),
    ),
    columns: { id: true },
  });
  if (!page) return c.json({ error: 'Not found' }, 404);

  const versions = await db.query.wikiPageVersions.findMany({
    where: eq(wikiPageVersions.wikiPageId, page.id),
    orderBy: [desc(wikiPageVersions.createdAt)],
    columns: {
      id: true,
      changeType: true,
      changedBy: true,
      promptVersion: true,
      contentSnapshot: true,
      createdAt: true,
    },
  });

  return c.json({ data: versions });
});

// Create wiki page from chat answer
app.post('/', async (c) => {
  const workspaceId = c.req.param('workspaceId')!;
  const body = await c.req.json<{ title: string; content: string; slug?: string }>();

  const slug = body.slug || body.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

  const [page] = await db
    .insert(wikiPages)
    .values({
      workspaceId,
      title: body.title,
      slug,
      content: body.content,
      summary: body.content.slice(0, 150),
      status: 'published',
      pageType: 'overview',
    })
    .onConflictDoNothing()
    .returning();

  if (!page) {
    return c.json({ error: 'Page with this slug already exists' }, 409);
  }

  return c.json({ data: page }, 201);
});

// Ego graph: 1-2 layer neighbors of a specific page
app.get('/graph/:pageId/ego', async (c) => {
  const workspaceId = c.req.param('workspaceId')!;
  const pageId = c.req.param('pageId')!;

  const allLinks = await db
    .select({ source: wikiLinks.sourcePageId, target: wikiLinks.targetPageId })
    .from(wikiLinks)
    .innerJoin(wikiPages, eq(wikiLinks.sourcePageId, wikiPages.id))
    .where(eq(wikiPages.workspaceId, workspaceId));

  // BFS 2 layers from pageId
  const visited = new Set<string>([pageId]);
  let frontier = new Set<string>([pageId]);

  for (let depth = 0; depth < 2; depth++) {
    const next = new Set<string>();
    for (const link of allLinks) {
      if (frontier.has(link.source) && !visited.has(link.target)) {
        next.add(link.target);
        visited.add(link.target);
      }
      if (frontier.has(link.target) && !visited.has(link.source)) {
        next.add(link.source);
        visited.add(link.source);
      }
    }
    frontier = next;
  }

  const nodeIds = [...visited];
  const nodes = await db.query.wikiPages.findMany({
    where: inArray(wikiPages.id, nodeIds),
    columns: { id: true, title: true, slug: true, pageType: true },
  });

  const egoLinks = allLinks.filter((l) => visited.has(l.source) && visited.has(l.target));

  const linkCountMap = new Map<string, number>();
  for (const link of egoLinks) {
    linkCountMap.set(link.source, (linkCountMap.get(link.source) || 0) + 1);
    linkCountMap.set(link.target, (linkCountMap.get(link.target) || 0) + 1);
  }

  return c.json({
    data: {
      centerId: pageId,
      nodes: nodes.map((p) => ({ ...p, linkCount: linkCountMap.get(p.id) || 0 })),
      links: egoLinks,
    },
  });
});

export default app;

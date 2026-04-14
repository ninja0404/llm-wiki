import { Hono } from 'hono';
import { db } from '../lib/db.js';
import { wikiPages } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const app = new Hono();

app.get('/markdown', async (c) => {
  const workspaceId = c.req.param('workspaceId')!;

  const pages = await db.query.wikiPages.findMany({
    where: and(
      eq(wikiPages.workspaceId, workspaceId),
      isNull(wikiPages.deletedAt),
      eq(wikiPages.status, 'published'),
    ),
    columns: { title: true, slug: true, content: true, summary: true, tags: true, pageType: true },
    orderBy: (w, { asc }) => [asc(w.title)],
  });

  const indexContent = [
    '# Wiki Index\n',
    ...pages.map((p) => `- [${p.title}](./${p.slug}.md) — ${p.summary || p.pageType}`),
  ].join('\n');

  const archive: Record<string, string> = { 'index.md': indexContent };

  for (const page of pages) {
    const frontmatter = [
      '---',
      `title: "${page.title}"`,
      `type: ${page.pageType}`,
      page.tags && page.tags.length > 0 ? `tags: [${page.tags.join(', ')}]` : null,
      page.summary ? `summary: "${page.summary}"` : null,
      '---',
      '',
    ].filter(Boolean).join('\n');

    archive[`${page.slug}.md`] = `${frontmatter}\n# ${page.title}\n\n${page.content}`;
  }

  const jsonPayload = JSON.stringify(archive);
  const compressed = await gzip(Buffer.from(jsonPayload));

  c.header('Content-Type', 'application/gzip');
  c.header('Content-Disposition', 'attachment; filename="wiki-export.json.gz"');

  return c.body(compressed);
});

app.get('/pages-json', async (c) => {
  const workspaceId = c.req.param('workspaceId')!;

  const pages = await db.query.wikiPages.findMany({
    where: and(
      eq(wikiPages.workspaceId, workspaceId),
      isNull(wikiPages.deletedAt),
      eq(wikiPages.status, 'published'),
    ),
    columns: { id: true, title: true, slug: true, content: true, summary: true, tags: true, pageType: true, updatedAt: true },
  });

  c.header('Content-Type', 'application/json');
  c.header('Content-Disposition', 'attachment; filename="wiki-export.json"');

  return c.json({ data: pages, exportedAt: new Date().toISOString(), totalPages: pages.length });
});

export default app;

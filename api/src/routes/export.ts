import { Hono } from 'hono';
import { db } from '../lib/db.js';
import { wikiPages } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import archiver from 'archiver';
import { PassThrough } from 'stream';

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
    `Exported: ${new Date().toISOString()}\n`,
    `Total pages: ${pages.length}\n`,
    '',
    ...pages.map((p) => `- [${p.title}](./${p.slug}.md) — ${p.summary || p.pageType}`),
  ].join('\n');

  const passthrough = new PassThrough();
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(passthrough);

  archive.append(indexContent, { name: 'index.md' });

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

    archive.append(`${frontmatter}\n# ${page.title}\n\n${page.content}`, {
      name: `${page.slug}.md`,
    });
  }

  await archive.finalize();

  c.header('Content-Type', 'application/zip');
  c.header('Content-Disposition', 'attachment; filename="wiki-export.zip"');

  return new Response(passthrough as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="wiki-export.zip"',
    },
  });
});

app.get('/json', async (c) => {
  const workspaceId = c.req.param('workspaceId')!;

  const pages = await db.query.wikiPages.findMany({
    where: and(
      eq(wikiPages.workspaceId, workspaceId),
      isNull(wikiPages.deletedAt),
      eq(wikiPages.status, 'published'),
    ),
    columns: { id: true, title: true, slug: true, content: true, summary: true, tags: true, pageType: true, updatedAt: true },
  });

  c.header('Content-Disposition', 'attachment; filename="wiki-export.json"');

  return c.json({ data: pages, exportedAt: new Date().toISOString(), totalPages: pages.length });
});

export default app;

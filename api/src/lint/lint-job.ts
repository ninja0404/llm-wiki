import { db } from '../lib/db.js';
import { wikiPages, wikiLinks, activityLogs } from '../db/schema/index.js';
import { eq, and, isNull, notInArray, sql } from 'drizzle-orm';
import { publishMessage } from '../lib/ws.js';
import { logger } from '../lib/logger.js';

export interface LintResult {
  orphanPages: { id: string; title: string; slug: string }[];
  brokenLinks: { sourcePageId: string; sourceTitle: string; targetSlug: string }[];
  contentBrokenLinks: { pageId: string; pageTitle: string; missingSlug: string }[];
  totalPagesScanned: number;
}

interface LintJobData {
  workspaceId: string;
  traceId?: string;
}

export async function processLintJob(data: LintJobData): Promise<LintResult> {
  const { workspaceId, traceId } = data;

  const allPages = await db.query.wikiPages.findMany({
    where: and(
      eq(wikiPages.workspaceId, workspaceId),
      isNull(wikiPages.deletedAt),
    ),
    columns: { id: true, title: true, slug: true, content: true, status: true },
  });

  const orphanPages = await findOrphanPages(workspaceId, allPages);
  const brokenLinks = await findBrokenLinks(workspaceId);
  const contentBrokenLinks = findContentBrokenLinks(allPages);

  const result: LintResult = {
    orphanPages,
    brokenLinks,
    contentBrokenLinks,
    totalPagesScanned: allPages.length,
  };

  await db.insert(activityLogs).values({
    workspaceId,
    action: 'lint_completed',
    entityType: 'workspace',
    traceId,
    details: {
      orphanCount: orphanPages.length,
      brokenLinkCount: brokenLinks.length,
      contentBrokenLinkCount: contentBrokenLinks.length,
      totalPagesScanned: allPages.length,
    },
  });

  await publishMessage(workspaceId, {
    type: 'lint:completed',
    payload: {
      workspaceId,
      orphanCount: orphanPages.length,
      brokenLinkCount: brokenLinks.length + contentBrokenLinks.length,
      totalPagesScanned: allPages.length,
    },
  });

  logger.info(
    {
      workspaceId,
      orphans: orphanPages.length,
      brokenLinks: brokenLinks.length,
      contentBrokenLinks: contentBrokenLinks.length,
      scanned: allPages.length,
    },
    'Lint completed',
  );

  return result;
}

async function findOrphanPages(
  workspaceId: string,
  allPages: { id: string; title: string; slug: string; status: string }[],
): Promise<{ id: string; title: string; slug: string }[]> {
  if (allPages.length <= 1) return [];

  const publishedPages = allPages.filter((p) => p.status === 'published');
  if (publishedPages.length === 0) return [];

  const linkedTargetIds = await db
    .selectDistinct({ targetPageId: wikiLinks.targetPageId })
    .from(wikiLinks)
    .innerJoin(wikiPages, eq(wikiLinks.sourcePageId, wikiPages.id))
    .where(eq(wikiPages.workspaceId, workspaceId));

  const linkedIdSet = new Set(linkedTargetIds.map((r) => r.targetPageId));

  return publishedPages
    .filter((p) => !linkedIdSet.has(p.id))
    .map(({ id, title, slug }) => ({ id, title, slug }));
}

async function findBrokenLinks(
  workspaceId: string,
): Promise<{ sourcePageId: string; sourceTitle: string; targetSlug: string }[]> {
  const results = await db.execute(sql`
    SELECT
      wl.source_page_id,
      sp.title as source_title,
      tp.slug as target_slug
    FROM wiki_links wl
    JOIN wiki_pages sp ON sp.id = wl.source_page_id
    LEFT JOIN wiki_pages tp ON tp.id = wl.target_page_id
    WHERE sp.workspace_id = ${workspaceId}
      AND sp.deleted_at IS NULL
      AND (tp.id IS NULL OR tp.deleted_at IS NOT NULL)
  `);

  return (results.rows as Record<string, unknown>[]).map((r) => ({
    sourcePageId: r.source_page_id as string,
    sourceTitle: r.source_title as string,
    targetSlug: (r.target_slug as string) || 'unknown',
  }));
}

const WIKI_LINK_PATTERN = /\[\[([a-z0-9-]+)\]\]/g;

function findContentBrokenLinks(
  allPages: { id: string; title: string; slug: string; content: string }[],
): { pageId: string; pageTitle: string; missingSlug: string }[] {
  const slugSet = new Set(allPages.map((p) => p.slug));
  const broken: { pageId: string; pageTitle: string; missingSlug: string }[] = [];

  for (const page of allPages) {
    let match;
    WIKI_LINK_PATTERN.lastIndex = 0;
    while ((match = WIKI_LINK_PATTERN.exec(page.content)) !== null) {
      const linkedSlug = match[1];
      if (!slugSet.has(linkedSlug)) {
        broken.push({ pageId: page.id, pageTitle: page.title, missingSlug: linkedSlug });
      }
    }
  }

  return broken;
}

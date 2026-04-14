import { z } from 'zod';

export const extractSchema = z.object({
  entities: z.array(
    z.object({
      name: z.string().describe('Entity name'),
      type: z.enum([
        'person',
        'project',
        'technology',
        'company',
        'concept',
        'methodology',
      ]),
      description: z.string().describe('Brief description of the entity'),
      sourceChunkIds: z.array(z.string()).describe('IDs of source chunks this entity was found in'),
    }),
  ),
  claims: z.array(
    z.object({
      statement: z.string().describe('A factual claim extracted from the source'),
      sourceChunkIds: z.array(z.string()).describe('IDs of source chunks supporting this claim'),
      confidence: z.enum(['high', 'medium', 'low']),
    }),
  ),
});

export type ExtractResult = z.infer<typeof extractSchema>;

export const wikiDecisionSchema = z.object({
  decisions: z.array(
    z.object({
      entitySlug: z.string(),
      action: z.enum(['create', 'update', 'flag']),
      matchedPageId: z.string().nullable().describe('ID of existing page to update, null for create'),
      title: z.string().describe('Page title'),
      content: z.string().describe('Full Markdown content for the page'),
      summary: z.string().describe('One-line summary'),
      pageType: z.enum(['entity', 'concept', 'source_summary', 'comparison', 'overview']),
      tags: z.array(z.string()),
      confidence: z.enum(['high', 'medium', 'low']),
      links: z.array(z.string()).describe('Slugs of pages linked from this content via [[slug]]'),
      flagReason: z.string().nullable().describe('Reason for flagging, null if not flagged'),
    }),
  ),
});

export type WikiDecisionResult = z.infer<typeof wikiDecisionSchema>;

export const queryRewriteSchema = z.object({
  rewritten: z.string().describe('Rewritten query for better search results'),
  searchTerms: z.array(z.string()).describe('Key search terms to use'),
});

export type QueryRewriteResult = z.infer<typeof queryRewriteSchema>;

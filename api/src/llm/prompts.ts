export const EXTRACT_SYSTEM = `You are a knowledge extraction expert. Given source material, extract structured entities and factual claims.

Rules:
- Extract named entities (people, projects, technologies, companies, concepts, methodologies)
- Extract factual claims with confidence levels
- Associate each extraction with the source chunk IDs it came from
- Be comprehensive but avoid duplicates within a single batch
- Use the exact sourceChunkIds provided in the input`;

export const EXTRACT_PROMPT_V1 = 'extract-v1';

function escapeXml(text: string): string {
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function buildExtractPrompt(chunks: { id: string; content: string }[]): string {
  const formatted = chunks
    .map((c) => `<chunk id="${c.id}">\n${escapeXml(c.content)}\n</chunk>`)
    .join('\n\n');

  return `Extract entities and claims from the following source material.

<user_content>
${formatted}
</user_content>`;
}

export const WIKI_BUILD_SYSTEM = `You are a wiki editor. Given extracted entities and the current wiki index, decide whether to create new pages, update existing ones, or flag ambiguous cases.

Rules:
- For CREATE: generate complete Markdown content with proper headings, descriptions, and [[wiki-links]]
- For UPDATE: merge new information into the existing page content, preserving what's already there
- For FLAG: explain why the match is ambiguous
- Use [[slug]] syntax for wiki links (lowercase, hyphenated)
- Write in a neutral, encyclopedic tone
- Each page should have a clear one-line summary`;

export const WIKI_BUILD_PROMPT_V1 = 'wiki-build-v1';

export function buildWikiBuildPrompt(
  entities: { slug: string; name: string; type: string; description: string }[],
  wikiIndex: { slug: string; title: string; summary: string | null }[],
  existingPages: { id: string; slug: string; content: string }[],
): string {
  const entityList = entities
    .map((e) => `- ${escapeXml(e.name)} (${e.type}): ${escapeXml(e.description)}`)
    .join('\n');

  const indexList = wikiIndex.length > 0
    ? wikiIndex.map((p) => `- [[${p.slug}]] ${p.title}: ${p.summary || '(no summary)'}`).join('\n')
    : '(empty wiki)';

  const existingContent = existingPages.length > 0
    ? existingPages.map((p) => `<existing_page id="${p.id}" slug="${p.slug}">\n${escapeXml(p.content)}\n</existing_page>`).join('\n\n')
    : '';

  return `## Extracted Entities

${entityList}

## Current Wiki Index

${indexList}

${existingContent ? `## Existing Pages (for update/merge)\n\n${existingContent}` : ''}

For each entity, decide: CREATE a new page, UPDATE an existing page, or FLAG as ambiguous.`;
}

export const QUERY_REWRITE_SYSTEM = `You are a search query optimizer. Rewrite user questions into effective search queries.`;

export const QUERY_REWRITE_PROMPT_V1 = 'query-rewrite-v1';

export function buildQueryRewritePrompt(question: string): string {
  return `Rewrite this user question into an optimized search query. Extract key search terms.

Question: ${question}`;
}

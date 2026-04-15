from __future__ import annotations

import fnmatch

from mcp.server.fastmcp import FastMCP

from llm_wiki_core.db import get_db_pool
from llm_wiki_core.markdown_ops import extract_sections

from ..core.auth import validate_agent


def _parse_page_range(page_range: str) -> list[int]:
    result: list[int] = []
    for chunk in page_range.split(","):
        part = chunk.strip()
        if not part:
            continue
        if "-" in part:
            start, end = part.split("-", 1)
            result.extend(range(int(start), int(end) + 1))
        else:
            result.append(int(part))
    return sorted(set(result))


def register_read_tool(mcp: FastMCP) -> None:
    @mcp.tool(name="read", description="Read one document, a page range, or a glob of documents.")
    async def read(
        workspace_id: str,
        agent_token: str,
        path: str,
        pages: str = "",
        sections: list[str] | None = None,
        include_images: bool = False,
    ) -> str:
        await validate_agent(workspace_id, agent_token, "read")
        pool = await get_db_pool()

        if "*" in path or "?" in path:
            docs = await pool.fetch(
                """
                SELECT path, title, kind::text AS kind
                FROM documents
                WHERE workspace_id = $1::uuid AND archived_at IS NULL
                ORDER BY path
                """,
                workspace_id,
            )
            pattern = path if path.startswith("/") else f"/{path}"
            matches = [row for row in docs if fnmatch.fnmatch(row["path"], pattern)]
            return "\n".join([f"- `{row['path']}` [{row['kind']}]" for row in matches]) or f"No documents match `{path}`."

        row = await pool.fetchrow(
            """
            SELECT d.id::text AS id, d.path, d.title, d.kind::text AS kind, d.mime_type,
                   dr.content_md
            FROM documents d
            LEFT JOIN document_revisions dr ON dr.id = d.current_revision_id
            WHERE d.workspace_id = $1::uuid AND d.path = $2 AND d.archived_at IS NULL
            """,
            workspace_id,
            path if path.startswith("/") else f"/{path}",
        )
        if not row:
            return f"Document `{path}` not found."

        if pages:
            page_rows = await pool.fetch(
                """
                SELECT page_no, text_md, elements_json
                FROM document_pages
                WHERE document_id = $1::uuid AND page_no = ANY($2::int[])
                ORDER BY page_no
                """,
                row["id"],
                _parse_page_range(pages),
            )
            if not page_rows:
                return f"No pages found for `{path}` and range `{pages}`."
            chunks = []
            for page_row in page_rows:
                chunks.append(f"## Page {page_row['page_no']}\n\n{page_row['text_md']}")
                if include_images and page_row["elements_json"].get("images"):
                    chunks.append(f"Images metadata: {page_row['elements_json']['images']}")
            return "\n\n".join(chunks)

        content = row["content_md"] or ""
        if sections:
            content = extract_sections(content, sections)
        return content

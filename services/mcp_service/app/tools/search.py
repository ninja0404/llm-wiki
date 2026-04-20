from __future__ import annotations

import fnmatch
from typing import Literal

from mcp.server.fastmcp import FastMCP

from llm_wiki_core.db import acquire
from llm_wiki_core.search_service import hybrid_search_workspace

from ..core.auth import validate_agent


def register_search_tool(mcp: FastMCP) -> None:
    @mcp.tool(name="search", description="List documents or run hybrid (lexical + semantic) search across blocks, wiki docs, and entities.")
    async def search(
        workspace_id: str,
        agent_token: str,
        mode: Literal["list", "search"] = "list",
        path: str = "*",
        query: str = "",
        tags: str = "",
        limit: int = 10,
    ) -> str:
        await validate_agent(workspace_id, agent_token, "search")
        async with acquire(workspace_id) as connection:
            if mode == "list":
                docs = await connection.fetch(
                    """
                    SELECT kind::text AS kind, path, title, status::text AS status, updated_at
                    FROM documents
                    WHERE workspace_id = $1::uuid AND archived_at IS NULL
                    ORDER BY path
                    """,
                    workspace_id,
                )
                matches = [row for row in docs if fnmatch.fnmatch(row["path"], path if path.startswith("/") else f"/{path}")]
                if not matches:
                    return f"No documents match `{path}`."
                return "\n".join(
                    [f"- `{row['path']}` [{row['kind']}] ({row['status']})" for row in matches[:limit]]
                )

            if not query.strip():
                return "Search mode requires `query`."
            result = await hybrid_search_workspace(connection, workspace_id, query, limit)
            search_rules = result.search_rules
            merged = result.items

            if tags:
                tag_set = {t.strip().lower() for t in tags.split(",") if t.strip()}
                if tag_set:
                    tagged_docs = await connection.fetch(
                        """
                        SELECT path, metadata
                        FROM documents
                        WHERE workspace_id = $1::uuid AND archived_at IS NULL
                          AND metadata ? 'tags'
                        """,
                        workspace_id,
                    )
                    tag_paths: set[str] = set()
                    for row in tagged_docs:
                        meta = row["metadata"]
                        doc_tags = meta.get("tags", []) if isinstance(meta, dict) else []
                        if isinstance(doc_tags, list) and any(str(t).lower() in tag_set for t in doc_tags):
                            tag_paths.add(row["path"])
                    merged = [r for r in merged if r["path"] in tag_paths]

            if not merged:
                return f"No search results for `{query}`."

            effective_limit = min(limit, search_rules["default_limit"]) if limit > 0 else search_rules["default_limit"]

            lines = ["Backend: pgroonga + semantic"]
            for row in merged[:effective_limit]:
                page_label = f" p.{row['page_no']}" if row["page_no"] else ""
                lines.append(f"- `{row['path']}`{page_label}: {row['snippet']}")
            return "\n".join(lines)

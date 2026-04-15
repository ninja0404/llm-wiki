from __future__ import annotations

import fnmatch
from typing import Literal

from mcp.server.fastmcp import FastMCP

from llm_wiki_core.config import get_settings
from llm_wiki_core.db import get_db_pool
from llm_wiki_core.embeddings import EmbeddingConfig, generate_embedding

from ..core.auth import validate_agent


async def _get_workspace_search_config(pool, workspace_id: str) -> tuple[EmbeddingConfig, dict]:
    row = await pool.fetchrow(
        "SELECT embedding_model, embedding_api_key, embedding_base_url, search_rules FROM workspace_settings WHERE workspace_id = $1::uuid",
        workspace_id,
    )
    if not row or not row["embedding_model"]:
        raise ValueError(f"Workspace {workspace_id} has no embedding_model configured")
    if not row["embedding_api_key"] or not row["embedding_base_url"]:
        raise ValueError(f"Workspace {workspace_id} has no embedding API key/URL configured")
    settings = get_settings()
    embed = EmbeddingConfig(
        api_key=row["embedding_api_key"],
        base_url=row["embedding_base_url"],
        model=row["embedding_model"],
        dimensions=settings.embedding_dimensions,
    )
    raw_rules = row["search_rules"] if row["search_rules"] else {}
    rules = {
        "default_limit": max(5, min(int(raw_rules.get("default_limit", 20)), 50)),
        "graph_boost_weight": max(0.0, min(float(raw_rules.get("graph_boost_weight", 0.15)), 1.0)),
        "min_score": max(0.0, min(float(raw_rules.get("min_score", 0)), 1.0)),
        "enable_semantic": bool(raw_rules.get("enable_semantic", True)),
    }
    return embed, rules


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
        pool = await get_db_pool()
        if mode == "list":
            docs = await pool.fetch(
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
        results = await pool.fetch(
            """
            SELECT 'block' AS result_type, d.path, d.title, db.page_no, left(db.text, 240) AS snippet
            FROM document_blocks db
            JOIN documents d ON d.id = db.document_id
            WHERE d.workspace_id = $1::uuid
              AND d.archived_at IS NULL
              AND db.text &@~ $2
            LIMIT $3
            """,
            workspace_id,
            query,
            min(limit, 25),
        )
        entities = await pool.fetch(
            """
            SELECT 'entity' AS result_type, '/wiki/entities/' || slug || '.md' AS path, title, NULL::int AS page_no,
                   summary AS snippet
            FROM entities
            WHERE workspace_id = $1::uuid
              AND (title ILIKE $2 OR summary ILIKE $2)
            LIMIT $3
            """,
            workspace_id,
            f"%{query}%",
            min(limit, 25),
        )

        wiki_docs = await pool.fetch(
            """
            SELECT 'wiki_doc' AS result_type, d.path, d.title, NULL::int AS page_no,
                   left(dr.content_md, 240) AS snippet
            FROM documents d
            JOIN document_revisions dr ON dr.id = d.current_revision_id
            WHERE d.workspace_id = $1::uuid AND d.archived_at IS NULL
              AND d.kind IN ('wiki', 'system') AND d.title &@~ $2
            LIMIT $3
            """,
            workspace_id,
            query,
            min(limit, 25),
        )

        embed_config, search_rules = await _get_workspace_search_config(pool, workspace_id)

        def _vec_lit(v: list[float]) -> str:
            return "[" + ",".join(f"{x:.8f}" for x in v) + "]"

        semantic: list = []
        if search_rules["enable_semantic"]:
            qvec = await generate_embedding(query, embed_config)
            qvec_str = _vec_lit(qvec)
            semantic = list(await pool.fetch(
                f"""
                SELECT 'semantic' AS result_type, d.path, d.title, db.page_no,
                       left(db.text, 240) AS snippet
                FROM document_blocks db
                JOIN documents d ON d.id = db.document_id
                WHERE d.workspace_id = $1::uuid
                  AND d.archived_at IS NULL
                  AND db.embedding IS NOT NULL
                ORDER BY db.embedding <=> '{qvec_str}'::vector
                LIMIT $2
                """,
                workspace_id,
                min(limit, 25),
            ))

        merged = list(results) + semantic + list(entities) + list(wiki_docs)

        if tags:
            tag_set = {t.strip().lower() for t in tags.split(",") if t.strip()}
            if tag_set:
                tagged_docs = await pool.fetch(
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

        seen: dict[tuple, dict] = {}
        for row in merged:
            key = (row["path"], row.get("page_no"))
            if key not in seen:
                seen[key] = dict(row)
        unique = list(seen.values())

        boost = search_rules["graph_boost_weight"]
        if boost > 0:
            graph_weights = await pool.fetch(
                """
                SELECT d.path,
                       (SELECT COUNT(*) FROM document_references dr WHERE dr.target_document_id = d.id) +
                       (SELECT COUNT(*) FROM citations c WHERE c.source_document_id = d.id) AS graph_score
                FROM documents d
                WHERE d.workspace_id = $1::uuid AND d.archived_at IS NULL
                """,
                workspace_id,
            )
            weight_map = {r["path"]: float(r["graph_score"]) for r in graph_weights}
            max_weight = max(weight_map.values()) if weight_map else 1.0
            for item in unique:
                raw = item.get("score") or 0
                item["score"] = raw + (weight_map.get(item["path"], 0) / max(max_weight, 1.0)) * boost

        min_s = search_rules["min_score"]
        if min_s > 0:
            unique = [item for item in unique if (item.get("score") or 0) >= min_s]

        unique.sort(key=lambda x: x.get("score") or 0, reverse=True)
        effective_limit = min(limit, search_rules["default_limit"]) if limit > 0 else search_rules["default_limit"]

        lines = ["Backend: pgroonga + semantic"]
        for row in unique[:effective_limit]:
            page_label = f" p.{row['page_no']}" if row["page_no"] else ""
            lines.append(f"- `{row['path']}`{page_label}: {row['snippet']}")
        return "\n".join(lines)

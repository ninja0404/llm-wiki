from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from ...core.deps import AuthContext, require_workspace_access
from llm_wiki_core.config import get_settings
from llm_wiki_core.db import get_db_pool
from llm_wiki_core.embeddings import EmbeddingConfig, generate_embedding


router = APIRouter(tags=["search"])


def _vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in values) + "]"


async def _get_workspace_embedding_config(pool, workspace_id: str) -> EmbeddingConfig:
    row = await pool.fetchrow(
        "SELECT embedding_model, embedding_api_key, embedding_base_url FROM workspace_settings WHERE workspace_id = $1::uuid",
        workspace_id,
    )
    if not row or not row["embedding_model"]:
        raise ValueError(f"Workspace {workspace_id} has no embedding_model configured")
    if not row["embedding_api_key"] or not row["embedding_base_url"]:
        raise ValueError(f"Workspace {workspace_id} has no embedding API key/URL configured")
    settings = get_settings()
    return EmbeddingConfig(
        api_key=row["embedding_api_key"],
        base_url=row["embedding_base_url"],
        model=row["embedding_model"],
        dimensions=settings.embedding_dimensions,
    )


def _get_search_rules(raw: dict | None) -> dict:
    r = raw or {}
    return {
        "default_limit": max(5, min(int(r.get("default_limit", 20)), 50)),
        "graph_boost_weight": max(0.0, min(float(r.get("graph_boost_weight", 0.15)), 1.0)),
        "min_score": max(0.0, min(float(r.get("min_score", 0)), 1.0)),
        "enable_semantic": bool(r.get("enable_semantic", True)),
    }


@router.get("/v1/workspaces/{workspace_id}/search")
async def search_workspace(
    workspace_id: str,
    auth: Annotated[AuthContext, Depends(require_workspace_access)],
    q: str = Query(min_length=1),
    limit: int = Query(default=0, ge=0, le=50),
) -> dict:
    pool = await get_db_pool()
    query = q.strip()

    ws_row = await pool.fetchrow(
        "SELECT embedding_model, embedding_api_key, embedding_base_url, search_rules FROM workspace_settings WHERE workspace_id = $1::uuid",
        workspace_id,
    )
    search_rules = _get_search_rules(ws_row["search_rules"] if ws_row else None)
    effective_limit = limit if limit > 0 else search_rules["default_limit"]

    embed_config = await _get_workspace_embedding_config(pool, workspace_id)
    query_embedding = _vector_literal(await generate_embedding(query, embed_config))
    lexical = await pool.fetch(
        """
        SELECT 'block' AS result_type, db.id::text AS id, d.path, d.title, db.page_no,
               pgroonga_score(db.tableoid, db.ctid) AS score,
               left(db.text, 300) AS snippet
        FROM document_blocks db
        JOIN documents d ON d.id = db.document_id
        WHERE d.workspace_id = $1::uuid AND d.archived_at IS NULL AND db.text &@~ $2
        ORDER BY score DESC
        LIMIT $3
        """,
        workspace_id,
        query,
        effective_limit,
    )
    wiki_docs = await pool.fetch(
        """
        SELECT 'document' AS result_type, d.id::text AS id, d.path, d.title, NULL::integer AS page_no,
               pgroonga_score(d.tableoid, d.ctid) AS score,
               left(dr.content_md, 300) AS snippet
        FROM documents d
        JOIN document_revisions dr ON dr.id = d.current_revision_id
        WHERE d.workspace_id = $1::uuid
          AND d.archived_at IS NULL
          AND d.kind IN ('wiki', 'system')
          AND d.title &@~ $2
        ORDER BY score DESC
        LIMIT $3
        """,
        workspace_id,
        query,
        effective_limit,
    )
    semantic_results: list = []
    if search_rules["enable_semantic"]:
        semantic_results = list(await pool.fetch(
            f"""
            SELECT 'semantic_block' AS result_type, db.id::text AS id, d.path, d.title, db.page_no,
                   1 - (db.embedding <=> '{query_embedding}'::vector) AS score,
                   left(db.text, 300) AS snippet
            FROM document_blocks db
            JOIN documents d ON d.id = db.document_id
            WHERE d.workspace_id = $1::uuid
              AND d.archived_at IS NULL
              AND db.embedding IS NOT NULL
            ORDER BY db.embedding <=> '{query_embedding}'::vector
            LIMIT $2
            """,
            workspace_id,
            effective_limit,
        ))
    entities = await pool.fetch(
        """
        SELECT 'entity' AS result_type, id::text AS id, '/wiki/entities/' || slug || '.md' AS path,
               title, NULL::integer AS page_no, 1.0 AS score, summary AS snippet
        FROM entities
        WHERE workspace_id = $1::uuid AND (title ILIKE $2 OR summary ILIKE $2)
        ORDER BY updated_at DESC
        LIMIT $3
        """,
        workspace_id,
        f"%{query}%",
        effective_limit,
    )
    merged = [dict(row) for row in lexical] + [dict(row) for row in semantic_results] + [dict(row) for row in wiki_docs] + [dict(row) for row in entities]
    deduped: dict[tuple[str, str | int | None], dict] = {}
    for item in merged:
        key = (item["path"], item.get("page_no"))
        existing = deduped.get(key)
        if existing is None or (item.get("score") or 0) > (existing.get("score") or 0):
            deduped[key] = item
    ranked = list(deduped.values())

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
    weight_map = {row["path"]: float(row["graph_score"]) for row in graph_weights}
    max_weight = max(weight_map.values()) if weight_map else 1.0
    boost = search_rules["graph_boost_weight"]
    for item in ranked:
        raw_score = float(item.get("score") or 0)
        graph_bonus = (weight_map.get(item["path"], 0) / max(max_weight, 1.0)) * boost
        item["score"] = raw_score + graph_bonus

    min_score = search_rules["min_score"]
    if min_score > 0:
        ranked = [item for item in ranked if (item.get("score") or 0) >= min_score]

    ranked.sort(key=lambda item: item.get("score") or 0, reverse=True)
    return {"data": ranked[:effective_limit], "backend": "pgroonga", "search_rules": search_rules}

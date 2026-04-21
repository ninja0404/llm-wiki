from __future__ import annotations

import logging
from dataclasses import dataclass

from .config import get_settings
from .crypto import decrypt_value
from .embeddings import EmbeddingConfig, generate_embedding

logger = logging.getLogger(__name__)

RRF_K = 60


@dataclass(slots=True)
class WorkspaceSearchResult:
    items: list[dict]
    search_rules: dict
    backend: str = "pgroonga"


def _vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in values) + "]"


def _rrf_fuse(channels: list[list[dict]], k: int = RRF_K) -> list[dict]:
    """Reciprocal Rank Fusion across multiple retrieval channels.

    Each channel is an independently ranked list. For each item the RRF
    score from channel *c* is ``1 / (k + rank)`` where rank is 1-based.
    Scores are summed across channels, and the item dict with the highest
    raw score is kept as representative (for snippet / metadata).
    """
    scores: dict[str, float] = {}
    best: dict[str, dict] = {}

    for channel in channels:
        for rank, item in enumerate(channel, start=1):
            item_id = item["id"]
            rrf_score = 1.0 / (k + rank)
            scores[item_id] = scores.get(item_id, 0.0) + rrf_score
            prev = best.get(item_id)
            if prev is None or (item.get("score") or 0) > (prev.get("score") or 0):
                best[item_id] = item

    merged: list[dict] = []
    for item_id, rrf_score in scores.items():
        entry = dict(best[item_id])
        entry["score"] = rrf_score
        merged.append(entry)
    merged.sort(key=lambda x: x["score"], reverse=True)
    return merged


def get_search_rules(raw: dict | None) -> dict:
    rules = raw or {}
    return {
        "default_limit": max(5, min(int(rules.get("default_limit", 20)), 50)),
        "graph_boost_weight": max(0.0, min(float(rules.get("graph_boost_weight", 0.15)), 1.0)),
        "min_score": max(0.0, min(float(rules.get("min_score", 0)), 1.0)),
        "enable_semantic": bool(rules.get("enable_semantic", True)),
        "enable_reranker": bool(rules.get("enable_reranker", True)),
        "reranker_url": str(rules.get("reranker_url", "")),
    }


async def _get_workspace_embedding_config(connection, workspace_id: str) -> EmbeddingConfig:
    row = await connection.fetchrow(
        """
        SELECT embedding_model, embedding_api_key_ciphertext, embedding_api_key_key_version, embedding_base_url
        FROM workspace_settings
        WHERE workspace_id = $1::uuid
        """,
        workspace_id,
    )
    if not row or not row["embedding_model"]:
        raise ValueError(f"Workspace {workspace_id} has no embedding_model configured")
    if not row["embedding_api_key_ciphertext"] or not row["embedding_api_key_key_version"] or not row["embedding_base_url"]:
        raise ValueError(f"Workspace {workspace_id} has no embedding API key/URL configured")

    settings = get_settings()
    return EmbeddingConfig(
        api_key=decrypt_value(row["embedding_api_key_ciphertext"], row["embedding_api_key_key_version"]),
        base_url=row["embedding_base_url"],
        model=row["embedding_model"],
        dimensions=settings.embedding_dimensions,
    )


async def hybrid_search_workspace(
    connection,
    workspace_id: str,
    query: str,
    limit: int = 0,
) -> WorkspaceSearchResult:
    workspace_settings = await connection.fetchrow(
        """
        SELECT search_rules
        FROM workspace_settings
        WHERE workspace_id = $1::uuid
        """,
        workspace_id,
    )
    search_rules = get_search_rules(workspace_settings["search_rules"] if workspace_settings else None)
    effective_limit = limit if limit > 0 else search_rules["default_limit"]

    query = query.strip()
    lexical = await connection.fetch(
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
    wiki_docs = await connection.fetch(
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
    entities = await connection.fetch(
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

    semantic_results: list = []
    if search_rules["enable_semantic"]:
        embed_config = await _get_workspace_embedding_config(connection, workspace_id)
        query_embedding = _vector_literal(await generate_embedding(query, embed_config))
        semantic_results = list(await connection.fetch(
            """
            SELECT 'semantic_block' AS result_type, db.id::text AS id, d.path, d.title, db.page_no,
                   1 - (db.embedding <=> $3::vector) AS score,
                   left(db.text, 300) AS snippet
            FROM document_blocks db
            JOIN documents d ON d.id = db.document_id
            WHERE d.workspace_id = $1::uuid
              AND d.archived_at IS NULL
              AND db.embedding IS NOT NULL
            ORDER BY db.embedding <=> $3::vector
            LIMIT $2
            """,
            workspace_id,
            effective_limit,
            query_embedding,
        ))

    channels: list[list[dict]] = [
        [dict(row) for row in lexical],
        [dict(row) for row in semantic_results],
        [dict(row) for row in wiki_docs],
        [dict(row) for row in entities],
    ]
    ranked = _rrf_fuse(channels)

    graph_weights = await connection.fetch(
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
    candidates = ranked[:effective_limit]

    if search_rules["enable_reranker"] and candidates:
        from .reranker import rerank
        try:
            candidates = rerank(query, candidates, search_rules)
        except Exception:
            logger.warning("reranker failed, using RRF order", exc_info=True)

    return WorkspaceSearchResult(items=candidates, search_rules=search_rules)

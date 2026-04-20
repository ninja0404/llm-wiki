from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from ...core.deps import AuthContext, get_workspace_conn, require_workspace_access


router = APIRouter(tags=["graph"])


def _entity_node(row: dict) -> dict:
    return {
        "id": f"entity:{row['id']}",
        "type": "entity",
        "ref_id": row["id"],
        "label": row["title"],
        "subtype": row.get("entity_type"),
        "path": f"/wiki/{'entities' if row.get('entity_type') in _ENTITY_KINDS else 'concepts'}/{row['slug']}.md",
        "document_kind": None,
        "meta": {"summary": row.get("summary", "")},
    }


def _claim_node(row: dict) -> dict:
    text = row.get("canonical_text", "")
    return {
        "id": f"claim:{row['id']}",
        "type": "claim",
        "ref_id": row["id"],
        "label": text[:120] + ("…" if len(text) > 120 else ""),
        "subtype": None,
        "path": None,
        "document_kind": None,
        "meta": {"confidence": float(row.get("confidence", 0)), "full_text": text},
    }


def _is_system_doc(path: str | None) -> bool:
    return path in _SYSTEM_PATHS if path else False


def _document_node(row: dict) -> dict:
    return {
        "id": f"document:{row['id']}",
        "type": "document",
        "ref_id": row["id"],
        "label": row.get("title", row.get("path", "")),
        "subtype": row.get("kind"),
        "path": row.get("path"),
        "document_kind": row.get("kind"),
        "meta": {},
    }


_ENTITY_KINDS = {"person", "company", "organization", "project", "product", "protocol", "event"}
_SYSTEM_PATHS = {"/wiki/log.md", "/wiki/overview.md"}


@router.get("/v1/workspaces/{workspace_id}/graph")
async def get_workspace_graph(
    workspace_id: str,
    auth: Annotated[AuthContext, Depends(require_workspace_access)],
    connection=Depends(get_workspace_conn),
    include_claims: bool = Query(default=True),
    include_documents: bool = Query(default=True),
    include_references: bool = Query(default=True),
    focus_document_id: str | None = Query(default=None),
    max_nodes: int = Query(default=300, ge=1, le=1000),
    max_edges: int = Query(default=600, ge=1, le=2000),
) -> dict:
    nodes: dict[str, dict] = {}
    edges: dict[str, dict] = {}

    if focus_document_id:
        return await _focused_graph(connection, workspace_id, focus_document_id, include_claims, include_documents, include_references, max_nodes, max_edges)

    entity_rows = await connection.fetch(
        "SELECT id::text AS id, slug, title, entity_type, summary FROM entities WHERE workspace_id = $1::uuid ORDER BY updated_at DESC LIMIT $2",
        workspace_id, max_nodes,
    )
    for row in entity_rows:
        node = _entity_node(dict(row))
        nodes[node["id"]] = node

    relation_rows = await connection.fetch(
        "SELECT id::text AS id, source_entity_id::text AS source_entity_id, target_entity_id::text AS target_entity_id, relation_type, metadata FROM relations WHERE workspace_id = $1::uuid LIMIT $2",
        workspace_id, max_edges,
    )
    for row in relation_rows:
        src = f"entity:{row['source_entity_id']}"
        tgt = f"entity:{row['target_entity_id']}"
        if src in nodes and tgt in nodes:
            eid = f"relation:{row['id']}"
            edges[eid] = {"id": eid, "type": "relation", "source": src, "target": tgt, "label": row["relation_type"], "meta": {"relation_type": row["relation_type"]}}

    if include_claims:
        claim_rows = await connection.fetch(
            "SELECT id::text AS id, entity_id::text AS entity_id, canonical_text, confidence FROM claims WHERE workspace_id = $1::uuid AND entity_id IS NOT NULL LIMIT $2",
            workspace_id, max_nodes,
        )
        for row in claim_rows:
            node = _claim_node(dict(row))
            nodes[node["id"]] = node
            entity_key = f"entity:{row['entity_id']}"
            if entity_key in nodes:
                eid = f"claim-entity:{row['id']}:{row['entity_id']}"
                edges[eid] = {"id": eid, "type": "claim_entity", "source": node["id"], "target": entity_key, "label": "supports", "meta": {}}

        if include_documents:
            citation_rows = await connection.fetch(
                """
                SELECT c.id::text AS id, c.claim_id::text AS claim_id, c.source_document_id::text AS source_document_id,
                       c.page_no, c.quote_text,
                       d.title AS doc_title, d.path AS doc_path, d.kind::text AS doc_kind
                FROM citations c
                JOIN documents d ON d.id = c.source_document_id
                WHERE c.workspace_id = $1::uuid
                LIMIT $2
                """,
                workspace_id, max_edges,
            )
            for row in citation_rows:
                if _is_system_doc(row.get("doc_path")):
                    continue
                doc_key = f"document:{row['source_document_id']}"
                if doc_key not in nodes:
                    nodes[doc_key] = _document_node({"id": row["source_document_id"], "title": row["doc_title"], "path": row["doc_path"], "kind": row["doc_kind"]})
                claim_key = f"claim:{row['claim_id']}"
                if claim_key in nodes:
                    eid = f"citation:{row['id']}"
                    edges[eid] = {"id": eid, "type": "citation", "source": claim_key, "target": doc_key, "label": "cites", "meta": {"page_no": row["page_no"], "quote_text": (row["quote_text"] or "")[:200]}}

    if include_references and include_documents:
        ref_rows = await connection.fetch(
            """
            SELECT dr.id::text AS id, dr.source_document_id::text AS source_document_id,
                   dr.target_document_id::text AS target_document_id, dr.ref_type,
                   sd.title AS src_title, sd.path AS src_path, sd.kind::text AS src_kind,
                   td.title AS tgt_title, td.path AS tgt_path, td.kind::text AS tgt_kind
            FROM document_references dr
            JOIN documents sd ON sd.id = dr.source_document_id
            JOIN documents td ON td.id = dr.target_document_id
            WHERE dr.workspace_id = $1::uuid
            LIMIT $2
            """,
            workspace_id, max_edges,
        )
        for row in ref_rows:
            if _is_system_doc(row.get("src_path")) or _is_system_doc(row.get("tgt_path")):
                continue
            src_key = f"document:{row['source_document_id']}"
            tgt_key = f"document:{row['target_document_id']}"
            if src_key not in nodes:
                nodes[src_key] = _document_node({"id": row["source_document_id"], "title": row["src_title"], "path": row["src_path"], "kind": row["src_kind"]})
            if tgt_key not in nodes:
                nodes[tgt_key] = _document_node({"id": row["target_document_id"], "title": row["tgt_title"], "path": row["tgt_path"], "kind": row["tgt_kind"]})
            eid = f"reference:{row['id']}"
            edges[eid] = {"id": eid, "type": "reference", "source": src_key, "target": tgt_key, "label": row["ref_type"], "meta": {"ref_type": row["ref_type"]}}

    truncated = len(nodes) >= max_nodes or len(edges) >= max_edges
    node_list = list(nodes.values())[:max_nodes]
    valid_node_ids = {n["id"] for n in node_list}
    edge_list = [e for e in list(edges.values())[:max_edges] if e["source"] in valid_node_ids and e["target"] in valid_node_ids]

    entity_count = sum(1 for n in node_list if n["type"] == "entity")
    claim_count = sum(1 for n in node_list if n["type"] == "claim")
    document_count = sum(1 for n in node_list if n["type"] == "document")
    relation_count = sum(1 for e in edge_list if e["type"] == "relation")
    citation_count = sum(1 for e in edge_list if e["type"] == "citation")
    reference_count = sum(1 for e in edge_list if e["type"] == "reference")

    return {
        "data": {
            "workspace_id": workspace_id,
            "summary": {
                "entity_count": entity_count,
                "claim_count": claim_count,
                "relation_count": relation_count,
                "citation_count": citation_count,
                "reference_count": reference_count,
                "document_count": document_count,
                "truncated": truncated,
            },
            "nodes": node_list,
            "edges": edge_list,
        }
    }


async def _focused_graph(
    pool, workspace_id: str, focus_document_id: str,
    include_claims: bool, include_documents: bool, include_references: bool,
    max_nodes: int, max_edges: int,
) -> dict:
    nodes: dict[str, dict] = {}
    edges: dict[str, dict] = {}

    if include_documents:
        doc_row = await pool.fetchrow(
            "SELECT id::text AS id, title, path, kind::text AS kind FROM documents WHERE id = $1::uuid AND workspace_id = $2::uuid",
            focus_document_id, workspace_id,
        )
        if doc_row:
            nodes[_document_node(dict(doc_row))["id"]] = _document_node(dict(doc_row))

    related_entities = await pool.fetch(
        """
        SELECT DISTINCT e.id::text AS id, e.slug, e.title, e.entity_type, e.summary
        FROM entities e
        JOIN claims cl ON cl.entity_id = e.id
        JOIN citations ci ON ci.claim_id = cl.id
        WHERE ci.source_document_id = $1::uuid AND e.workspace_id = $2::uuid
        LIMIT $3
        """,
        focus_document_id, workspace_id, max_nodes,
    )
    for row in related_entities:
        node = _entity_node(dict(row))
        nodes[node["id"]] = node

    if include_claims:
        focus_claims = await pool.fetch(
            """
            SELECT cl.id::text AS id, cl.entity_id::text AS entity_id, cl.canonical_text, cl.confidence,
                   ci.id::text AS citation_id, ci.page_no, ci.quote_text
            FROM claims cl
            JOIN citations ci ON ci.claim_id = cl.id
            WHERE ci.source_document_id = $1::uuid AND cl.workspace_id = $2::uuid
            LIMIT $3
            """,
            focus_document_id, workspace_id, max_nodes,
        )
        for row in focus_claims:
            node = _claim_node(dict(row))
            nodes[node["id"]] = node
            if row["entity_id"]:
                entity_key = f"entity:{row['entity_id']}"
                if entity_key in nodes:
                    eid = f"claim-entity:{row['id']}:{row['entity_id']}"
                    edges[eid] = {"id": eid, "type": "claim_entity", "source": node["id"], "target": entity_key, "label": "supports", "meta": {}}
            if include_documents:
                doc_key = f"document:{focus_document_id}"
                if doc_key in nodes:
                    eid = f"citation:{row['citation_id']}"
                    edges[eid] = {"id": eid, "type": "citation", "source": node["id"], "target": doc_key, "label": "cites", "meta": {"page_no": row["page_no"], "quote_text": (row["quote_text"] or "")[:200]}}

    entity_ids = [n["ref_id"] for n in nodes.values() if n["type"] == "entity"]
    if entity_ids:
        placeholders = ", ".join(f"${i+3}::uuid" for i in range(len(entity_ids)))
        rels = await pool.fetch(
            f"""
            SELECT id::text AS id, source_entity_id::text AS source_entity_id,
                   target_entity_id::text AS target_entity_id, relation_type
            FROM relations
            WHERE workspace_id = $1::uuid
              AND (source_entity_id IN ({placeholders}) OR target_entity_id IN ({placeholders}))
            LIMIT $2
            """,
            workspace_id, max_edges, *entity_ids,
        )
        for row in rels:
            src = f"entity:{row['source_entity_id']}"
            tgt = f"entity:{row['target_entity_id']}"
            if src in nodes and tgt in nodes:
                eid = f"relation:{row['id']}"
                edges[eid] = {"id": eid, "type": "relation", "source": src, "target": tgt, "label": row["relation_type"], "meta": {"relation_type": row["relation_type"]}}

    if include_references and include_documents:
        refs = await pool.fetch(
            """
            SELECT dr.id::text AS id, dr.source_document_id::text AS source_document_id,
                   dr.target_document_id::text AS target_document_id, dr.ref_type,
                   td.title AS tgt_title, td.path AS tgt_path, td.kind::text AS tgt_kind
            FROM document_references dr
            JOIN documents td ON td.id = dr.target_document_id
            WHERE (dr.source_document_id = $1::uuid OR dr.target_document_id = $1::uuid)
              AND dr.workspace_id = $2::uuid
            LIMIT $3
            """,
            focus_document_id, workspace_id, max_edges,
        )
        for row in refs:
            tgt_key = f"document:{row['target_document_id']}"
            src_key = f"document:{row['source_document_id']}"
            if tgt_key not in nodes:
                nodes[tgt_key] = _document_node({"id": row["target_document_id"], "title": row["tgt_title"], "path": row["tgt_path"], "kind": row["tgt_kind"]})
            if src_key not in nodes:
                src_doc = await pool.fetchrow(
                    "SELECT id::text AS id, title, path, kind::text AS kind FROM documents WHERE id = $1::uuid",
                    row["source_document_id"],
                )
                if src_doc:
                    nodes[src_key] = _document_node(dict(src_doc))
            eid = f"reference:{row['id']}"
            edges[eid] = {"id": eid, "type": "reference", "source": src_key, "target": tgt_key, "label": row["ref_type"], "meta": {}}

    truncated = len(nodes) >= max_nodes or len(edges) >= max_edges
    node_list = list(nodes.values())[:max_nodes]
    valid_ids = {n["id"] for n in node_list}
    edge_list = [e for e in list(edges.values())[:max_edges] if e["source"] in valid_ids and e["target"] in valid_ids]

    return {
        "data": {
            "workspace_id": workspace_id,
            "summary": {
                "entity_count": sum(1 for n in node_list if n["type"] == "entity"),
                "claim_count": sum(1 for n in node_list if n["type"] == "claim"),
                "relation_count": sum(1 for e in edge_list if e["type"] == "relation"),
                "citation_count": sum(1 for e in edge_list if e["type"] == "citation"),
                "reference_count": sum(1 for e in edge_list if e["type"] == "reference"),
                "document_count": sum(1 for n in node_list if n["type"] == "document"),
                "truncated": truncated,
            },
            "nodes": node_list,
            "edges": edge_list,
        }
    }

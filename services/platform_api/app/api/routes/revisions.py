from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from ...core.deps import AuthContext, require_auth
from llm_wiki_core.db import get_db_pool
from llm_wiki_core.diffing import build_line_diff


router = APIRouter(tags=["revisions"])


@router.get("/v1/documents/{document_id}/revisions")
async def list_revisions(document_id: str, auth: Annotated[AuthContext, Depends(require_auth)]) -> dict:
    pool = await get_db_pool()
    workspace_id = await pool.fetchval("SELECT workspace_id::text FROM documents WHERE id = $1::uuid", document_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="Document not found")
    if auth.workspace_roles and workspace_id not in auth.workspace_roles:
        raise HTTPException(status_code=403, detail="Workspace access denied")
    rows = await pool.fetch(
        """
        SELECT id::text AS id, actor_type::text AS actor_type, actor_id, run_id::text AS run_id,
               reason, diff_summary, created_at
        FROM document_revisions
        WHERE document_id = $1::uuid
        ORDER BY created_at DESC
        """,
        document_id,
    )
    return {"data": [dict(row) for row in rows]}


@router.get("/v1/workspaces/{workspace_id}/revisions")
async def list_workspace_revisions(
    workspace_id: str,
    auth: Annotated[AuthContext, Depends(require_auth)],
) -> dict:
    if auth.workspace_roles and workspace_id not in auth.workspace_roles:
        raise HTTPException(status_code=403, detail="Workspace access denied")
    pool = await get_db_pool()
    rows = await pool.fetch(
        """
        SELECT dr.id::text AS id, dr.actor_type::text AS actor_type, dr.actor_id, dr.run_id::text AS run_id,
               dr.reason, dr.diff_summary, dr.created_at, d.path, d.title
        FROM document_revisions dr
        JOIN documents d ON d.id = dr.document_id
        WHERE d.workspace_id = $1::uuid
        ORDER BY dr.created_at DESC
        LIMIT 100
        """,
        workspace_id,
    )
    return {"data": [dict(row) for row in rows]}


@router.get("/v1/revisions/{revision_id}")
async def get_revision(revision_id: str, auth: Annotated[AuthContext, Depends(require_auth)]) -> dict:
    pool = await get_db_pool()
    row = await pool.fetchrow(
        """
        SELECT dr.id::text AS id, dr.actor_type::text AS actor_type, dr.actor_id, dr.run_id::text AS run_id,
               dr.reason, dr.diff_summary, dr.content_md, dr.created_at, d.workspace_id::text AS workspace_id, d.path, d.title,
               prev.id::text AS previous_revision_id, prev.content_md AS previous_content_md
        FROM document_revisions dr
        JOIN documents d ON d.id = dr.document_id
        LEFT JOIN LATERAL (
            SELECT p.id, p.content_md
            FROM document_revisions p
            WHERE p.document_id = dr.document_id
              AND p.created_at < dr.created_at
            ORDER BY p.created_at DESC
            LIMIT 1
        ) prev ON TRUE
        WHERE dr.id = $1::uuid
        """,
        revision_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Revision not found")
    if auth.workspace_roles and row["workspace_id"] not in auth.workspace_roles:
        raise HTTPException(status_code=403, detail="Workspace access denied")
    return {"data": dict(row)}


@router.get("/v1/revisions/{revision_id}/diff")
async def get_revision_diff(revision_id: str, auth: Annotated[AuthContext, Depends(require_auth)]) -> dict:
    pool = await get_db_pool()
    row = await pool.fetchrow(
        """
        SELECT dr.content_md, d.workspace_id::text AS workspace_id, prev.content_md AS previous_content_md
        FROM document_revisions dr
        JOIN documents d ON d.id = dr.document_id
        LEFT JOIN LATERAL (
            SELECT p.content_md
            FROM document_revisions p
            WHERE p.document_id = dr.document_id
              AND p.created_at < dr.created_at
            ORDER BY p.created_at DESC
            LIMIT 1
        ) prev ON TRUE
        WHERE dr.id = $1::uuid
        """,
        revision_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Revision not found")
    if auth.workspace_roles and row["workspace_id"] not in auth.workspace_roles:
        raise HTTPException(status_code=403, detail="Workspace access denied")
    return {"data": build_line_diff(row["previous_content_md"] or "", row["content_md"] or "")}

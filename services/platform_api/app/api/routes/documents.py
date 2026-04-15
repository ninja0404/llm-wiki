from __future__ import annotations

import os
import re
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from ...core.deps import AuthContext, require_agent_write_scope, require_auth, require_workspace_access
import orjson

from llm_wiki_core.audit import log_activity
from llm_wiki_core.db import get_db_pool
from llm_wiki_core.markdown_ops import append_markdown, replace_exact_once
from llm_wiki_core.queue import enqueue_run
from llm_wiki_core.storage import put_bytes


router = APIRouter(tags=["documents"])


def normalize_path(path: str) -> str:
    path = path.strip() or "/"
    if not path.startswith("/"):
        path = "/" + path
    return path


def build_document_path(base_path: str, title: str, extension: str = "md") -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") or "untitled"
    if base_path.endswith("/"):
        return f"{base_path}{slug}.{extension}"
    return f"{base_path}/{slug}.{extension}"


def validate_document_path(path: str, kind: str) -> str:
    """Validate and normalize a document path. Path must be the final exact path."""
    path = path.strip()
    if not path:
        raise HTTPException(status_code=400, detail="Path is required")
    if not path.startswith("/"):
        path = "/" + path
    if path.endswith("/"):
        raise HTTPException(status_code=400, detail="Path must not end with '/' — it must be a file path, not a directory")
    if kind == "wiki" and not path.endswith(".md"):
        raise HTTPException(status_code=400, detail="Wiki document path must end with '.md'")
    return path


class CreateWikiDocumentRequest(BaseModel):
    path: str
    title: str = Field(min_length=1, max_length=200)
    content: str
    policy: str = "agent_editable"
    kind: str = "wiki"


class AppendRequest(BaseModel):
    content: str = Field(min_length=1)
    reason: str = Field(default="Append content")


class ReplaceRequest(BaseModel):
    old_text: str = Field(min_length=1)
    new_text: str
    reason: str = Field(default="Replace exact text")


@router.get("/v1/workspaces/{workspace_id}/documents")
async def list_documents(
    workspace_id: str,
    auth: Annotated[AuthContext, Depends(require_workspace_access)],
    path_prefix: str | None = None,
    kind: str | None = None,
) -> dict:
    pool = await get_db_pool()
    sql = """
        SELECT d.id::text AS id, d.kind::text AS kind, d.path, d.title, d.mime_type,
               d.status::text AS status, d.policy::text AS policy, d.metadata,
               d.updated_at, dr.content_md
        FROM documents d
        LEFT JOIN document_revisions dr ON dr.id = d.current_revision_id
        WHERE d.workspace_id = $1::uuid AND d.archived_at IS NULL
    """
    params: list[object] = [workspace_id]
    if path_prefix:
        sql += f" AND d.path LIKE ${len(params) + 1}"
        params.append(f"{normalize_path(path_prefix)}%")
    if kind:
        sql += f" AND d.kind = ${len(params) + 1}::document_kind"
        params.append(kind)
    sql += " ORDER BY d.path"
    rows = await pool.fetch(sql, *params)
    return {"data": [dict(row) for row in rows]}


@router.get("/v1/workspaces/{workspace_id}/documents/by-path")
async def get_document_by_path(
    workspace_id: str,
    path: str,
    auth: Annotated[AuthContext, Depends(require_workspace_access)],
) -> dict:
    pool = await get_db_pool()
    row = await pool.fetchrow(
        """
        SELECT d.id::text AS id, d.kind::text AS kind, d.path, d.title, d.mime_type,
               d.status::text AS status, d.policy::text AS policy, d.metadata,
               dr.content_md, d.updated_at
        FROM documents d
        LEFT JOIN document_revisions dr ON dr.id = d.current_revision_id
        WHERE d.workspace_id = $1::uuid
          AND d.path = $2
          AND d.archived_at IS NULL
        """,
        workspace_id,
        path if path.startswith("/") else f"/{path}",
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"data": dict(row)}


@router.post("/v1/workspaces/{workspace_id}/documents/wiki")
async def create_wiki_document(
    workspace_id: str,
    body: CreateWikiDocumentRequest,
    auth: Annotated[AuthContext, Depends(require_workspace_access)],
) -> dict:
    require_agent_write_scope(auth)
    pool = await get_db_pool()
    document_path = validate_document_path(body.path, body.kind)
    async with pool.acquire() as connection:
        async with connection.transaction():
            document = await connection.fetchrow(
                """
                INSERT INTO documents (workspace_id, kind, path, title, mime_type, status, policy)
                VALUES ($1::uuid, $2::document_kind, $3, $4, 'text/markdown', 'ready', $5::document_policy)
                RETURNING id::text AS id
                """,
                workspace_id,
                body.kind,
                document_path,
                body.title,
                body.policy,
            )
            run = await connection.fetchrow(
                """
                INSERT INTO runs (workspace_id, run_type, status, actor_type, actor_id, input, started_at, completed_at)
                VALUES ($1::uuid, 'agent_edit', 'succeeded', $2::actor_type, $3, $4::jsonb, NOW(), NOW())
                RETURNING id::text AS id
                """,
                workspace_id,
                auth.actor_type,
                auth.actor_id,
                orjson.dumps({"op": "create_doc", "path": document_path}).decode(),
            )
            revision = await connection.fetchrow(
                """
                INSERT INTO document_revisions (document_id, actor_type, actor_id, run_id, reason, content_md, content_ast, diff_summary)
                VALUES ($1::uuid, $2::actor_type, $3, $4::uuid, 'Create document', $5, '{}'::jsonb, '{"op":"create_doc"}'::jsonb)
                RETURNING id::text AS id
                """,
                document["id"],
                auth.actor_type,
                auth.actor_id,
                run["id"],
                body.content,
            )
            await connection.execute(
                "UPDATE documents SET current_revision_id = $1::uuid WHERE id = $2::uuid",
                revision["id"],
                document["id"],
            )
            await connection.execute(
                """
                INSERT INTO run_steps (run_id, step_key, status, payload, started_at, completed_at)
                VALUES ($1::uuid, 'create_doc', 'succeeded', $2::jsonb, NOW(), NOW())
                """,
                run["id"],
                orjson.dumps({"path": document_path, "title": body.title}).decode(),
            )
    await log_activity(
        workspace_id=workspace_id,
        actor_type=auth.actor_type,
        actor_id=auth.actor_id,
        event_type="document.created",
        payload={"path": document_path, "title": body.title, "kind": body.kind},
        document_id=document["id"],
        run_id=run["id"],
    )
    return {"data": {"document_id": document["id"], "run_id": run["id"], "path": document_path}}


@router.post("/v1/workspaces/{workspace_id}/documents/upload")
async def upload_source_document(
    workspace_id: str,
    auth: Annotated[AuthContext, Depends(require_workspace_access)],
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    source_path: str = Form(default="/sources/"),
) -> dict:
    require_agent_write_scope(auth)
    data = await file.read()
    document_title = title or os.path.splitext(file.filename or "source")[0]
    path = build_document_path(normalize_path(source_path), document_title, file.filename.rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "bin")
    storage_key = f"{workspace_id}/{path.lstrip('/')}"
    put_bytes(storage_key, data, file.content_type or "application/octet-stream")

    pool = await get_db_pool()
    async with pool.acquire() as connection:
        async with connection.transaction():
            document = await connection.fetchrow(
                """
                INSERT INTO documents (workspace_id, kind, path, title, mime_type, status, policy, metadata)
                VALUES ($1::uuid, 'source', $2, $3, $4, 'queued', 'system_managed', $5::jsonb)
                RETURNING id::text AS id
                """,
                workspace_id,
                path,
                document_title,
                file.content_type or "application/octet-stream",
                {
                    "storage_key": storage_key,
                    "filename": file.filename,
                    "size": len(data),
                    "mime_type": file.content_type or "application/octet-stream",
                },
            )
            revision = await connection.fetchrow(
                """
                INSERT INTO document_revisions (document_id, actor_type, actor_id, reason, content_md, content_ast, diff_summary)
                VALUES ($1::uuid, $2::actor_type, $3, 'Source uploaded', $4, '{}'::jsonb, '{"op":"create_doc"}'::jsonb)
                RETURNING id::text AS id
                """,
                document["id"],
                auth.actor_type,
                auth.actor_id,
                f"Uploaded source `{file.filename}`",
            )
            await connection.execute(
                "UPDATE documents SET current_revision_id = $1::uuid WHERE id = $2::uuid",
                revision["id"],
                document["id"],
            )
            run = await connection.fetchrow(
                """
                INSERT INTO runs (workspace_id, run_type, actor_type, actor_id, input)
                VALUES ($1::uuid, 'ingest', $2::actor_type, $3, $4::jsonb)
                RETURNING id::text AS id
                """,
                workspace_id,
                auth.actor_type,
                auth.actor_id,
                {"document_id": document["id"]},
            )
    await enqueue_run(run["id"])
    await log_activity(
        workspace_id=workspace_id,
        actor_type=auth.actor_type,
        actor_id=auth.actor_id,
        event_type="source.uploaded",
        payload={"path": path, "filename": file.filename, "size": len(data)},
        document_id=document["id"],
        run_id=run["id"],
    )
    return {"data": {"document_id": document["id"], "run_id": run["id"], "path": path}}


@router.get("/v1/documents/{document_id}")
async def get_document(document_id: str, auth: Annotated[AuthContext, Depends(require_auth)]) -> dict:
    pool = await get_db_pool()
    row = await pool.fetchrow(
        """
        SELECT d.id::text AS id, d.workspace_id::text AS workspace_id, d.kind::text AS kind, d.path, d.title,
               d.mime_type, d.status::text AS status, d.policy::text AS policy, d.metadata,
               dr.content_md, d.updated_at
        FROM documents d
        LEFT JOIN document_revisions dr ON dr.id = d.current_revision_id
        WHERE d.id = $1::uuid
        """,
        document_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    if auth.workspace_roles and row["workspace_id"] not in auth.workspace_roles:
        raise HTTPException(status_code=403, detail="Workspace access denied")
    return {"data": dict(row)}


@router.get("/v1/documents/{document_id}/pages")
async def get_document_pages(document_id: str, auth: Annotated[AuthContext, Depends(require_auth)]) -> dict:
    pool = await get_db_pool()
    workspace_id = await pool.fetchval("SELECT workspace_id::text FROM documents WHERE id = $1::uuid", document_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="Document not found")
    if auth.workspace_roles and workspace_id not in auth.workspace_roles:
        raise HTTPException(status_code=403, detail="Workspace access denied")
    rows = await pool.fetch(
        """
        SELECT id::text AS id, page_no, text_md, elements_json, char_count
        FROM document_pages
        WHERE document_id = $1::uuid
        ORDER BY page_no
        """,
        document_id,
    )
    return {"data": [dict(row) for row in rows]}


@router.get("/v1/documents/{document_id}/blocks")
async def get_document_blocks(document_id: str, auth: Annotated[AuthContext, Depends(require_auth)]) -> dict:
    pool = await get_db_pool()
    workspace_id = await pool.fetchval("SELECT workspace_id::text FROM documents WHERE id = $1::uuid", document_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="Document not found")
    if auth.workspace_roles and workspace_id not in auth.workspace_roles:
        raise HTTPException(status_code=403, detail="Workspace access denied")
    rows = await pool.fetch(
        """
        SELECT id::text AS id, page_no, block_type, heading_path, text, bbox, token_count
        FROM document_blocks
        WHERE document_id = $1::uuid
        ORDER BY page_no, created_at
        """,
        document_id,
    )
    return {"data": [dict(row) for row in rows]}


@router.get("/v1/documents/{document_id}/references")
async def get_document_references(document_id: str, auth: Annotated[AuthContext, Depends(require_auth)]) -> dict:
    pool = await get_db_pool()
    workspace_id = await pool.fetchval("SELECT workspace_id::text FROM documents WHERE id = $1::uuid", document_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="Document not found")
    if auth.workspace_roles and workspace_id not in auth.workspace_roles:
        raise HTTPException(status_code=403, detail="Workspace access denied")
    rows = await pool.fetch(
        """
        SELECT dr.id::text AS id, dr.ref_type, dr.metadata,
               source_doc.path AS source_path, target_doc.path AS target_path, target_doc.title AS target_title
        FROM document_references dr
        JOIN documents source_doc ON source_doc.id = dr.source_document_id
        JOIN documents target_doc ON target_doc.id = dr.target_document_id
        WHERE dr.source_document_id = $1::uuid OR dr.target_document_id = $1::uuid
        ORDER BY dr.created_at DESC
        """,
        document_id,
    )
    return {"data": [dict(row) for row in rows]}


@router.get("/v1/documents/{document_id}/citations")
async def get_document_citations(document_id: str, auth: Annotated[AuthContext, Depends(require_auth)]) -> dict:
    pool = await get_db_pool()
    workspace_id = await pool.fetchval("SELECT workspace_id::text FROM documents WHERE id = $1::uuid", document_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="Document not found")
    if auth.workspace_roles and workspace_id not in auth.workspace_roles:
        raise HTTPException(status_code=403, detail="Workspace access denied")
    rows = await pool.fetch(
        """
        SELECT c.id::text AS id, c.page_no, c.quote_text, c.metadata,
               claim.canonical_text,
               source_doc.path AS source_path
        FROM citations c
        LEFT JOIN claims claim ON claim.id = c.claim_id
        JOIN documents source_doc ON source_doc.id = c.source_document_id
        WHERE c.source_document_id = $1::uuid
        ORDER BY c.created_at DESC
        """,
        document_id,
    )
    return {"data": [dict(row) for row in rows]}


@router.post("/v1/documents/{document_id}/append")
async def append_document_content(
    document_id: str,
    body: AppendRequest,
    auth: Annotated[AuthContext, Depends(require_auth)],
) -> dict:
    require_agent_write_scope(auth)
    pool = await get_db_pool()
    row = await pool.fetchrow(
        """
        SELECT d.id::text AS id, d.workspace_id::text AS workspace_id, d.policy::text AS policy, dr.content_md
        FROM documents d
        LEFT JOIN document_revisions dr ON dr.id = d.current_revision_id
        WHERE d.id = $1::uuid
        """,
        document_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    if auth.workspace_roles and row["workspace_id"] not in auth.workspace_roles:
        raise HTTPException(status_code=403, detail="Workspace access denied")
    if row["policy"] == "locked":
        raise HTTPException(status_code=409, detail="Document is locked")
    new_content = append_markdown(row["content_md"] or "", body.content)
    async with pool.acquire() as conn:
        async with conn.transaction():
            run = await conn.fetchrow(
                """
                INSERT INTO runs (workspace_id, run_type, status, actor_type, actor_id, input, started_at, completed_at)
                VALUES ($1::uuid, 'agent_edit', 'succeeded', $2::actor_type, $3, $4::jsonb, NOW(), NOW())
                RETURNING id::text AS id
                """,
                row["workspace_id"],
                auth.actor_type,
                auth.actor_id,
                orjson.dumps({"op": "append_content", "document_id": document_id}).decode(),
            )
            revision = await conn.fetchrow(
                """
                INSERT INTO document_revisions (document_id, actor_type, actor_id, run_id, reason, content_md, content_ast, diff_summary)
                VALUES ($1::uuid, $2::actor_type, $3, $4::uuid, $5, $6, '{}'::jsonb, '{"op":"append_content"}'::jsonb)
                RETURNING id::text AS id
                """,
                document_id,
                auth.actor_type,
                auth.actor_id,
                run["id"],
                body.reason,
                new_content,
            )
            await conn.execute("UPDATE documents SET current_revision_id = $1::uuid WHERE id = $2::uuid", revision["id"], document_id)
            await conn.execute(
                """
                INSERT INTO run_steps (run_id, step_key, status, payload, started_at, completed_at)
                VALUES ($1::uuid, 'append_content', 'succeeded', $2::jsonb, NOW(), NOW())
                """,
                run["id"],
                orjson.dumps({"document_id": document_id, "reason": body.reason}).decode(),
            )
    await log_activity(
        workspace_id=row["workspace_id"],
        actor_type=auth.actor_type,
        actor_id=auth.actor_id,
        event_type="document.appended",
        payload={"reason": body.reason},
        document_id=document_id,
        run_id=run["id"],
    )
    return {"data": {"revision_id": revision["id"], "run_id": run["id"]}}


@router.post("/v1/documents/{document_id}/replace")
async def replace_document_content(
    document_id: str,
    body: ReplaceRequest,
    auth: Annotated[AuthContext, Depends(require_auth)],
) -> dict:
    require_agent_write_scope(auth)
    pool = await get_db_pool()
    row = await pool.fetchrow(
        """
        SELECT d.id::text AS id, d.workspace_id::text AS workspace_id, d.policy::text AS policy, dr.content_md
        FROM documents d
        LEFT JOIN document_revisions dr ON dr.id = d.current_revision_id
        WHERE d.id = $1::uuid
        """,
        document_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    if auth.workspace_roles and row["workspace_id"] not in auth.workspace_roles:
        raise HTTPException(status_code=403, detail="Workspace access denied")
    if row["policy"] in {"locked", "append_only"}:
        raise HTTPException(status_code=409, detail="Document policy forbids replace")
    result = replace_exact_once(row["content_md"] or "", body.old_text, body.new_text)
    if result.occurrences == 0:
        raise HTTPException(status_code=400, detail="No matching text found")
    if result.occurrences > 1:
        raise HTTPException(status_code=400, detail="Replacement must match exactly once")
    async with pool.acquire() as conn:
        async with conn.transaction():
            run = await conn.fetchrow(
                """
                INSERT INTO runs (workspace_id, run_type, status, actor_type, actor_id, input, started_at, completed_at)
                VALUES ($1::uuid, 'agent_edit', 'succeeded', $2::actor_type, $3, $4::jsonb, NOW(), NOW())
                RETURNING id::text AS id
                """,
                row["workspace_id"],
                auth.actor_type,
                auth.actor_id,
                orjson.dumps({"op": "replace_section", "document_id": document_id}).decode(),
            )
            revision = await conn.fetchrow(
                """
                INSERT INTO document_revisions (document_id, actor_type, actor_id, run_id, reason, content_md, content_ast, diff_summary)
                VALUES ($1::uuid, $2::actor_type, $3, $4::uuid, $5, $6, '{}'::jsonb, '{"op":"replace_section"}'::jsonb)
                RETURNING id::text AS id
                """,
                document_id,
                auth.actor_type,
                auth.actor_id,
                run["id"],
                body.reason,
                result.content,
            )
            await conn.execute("UPDATE documents SET current_revision_id = $1::uuid WHERE id = $2::uuid", revision["id"], document_id)
            await conn.execute(
                """
                INSERT INTO run_steps (run_id, step_key, status, payload, started_at, completed_at)
                VALUES ($1::uuid, 'replace_section', 'succeeded', $2::jsonb, NOW(), NOW())
                """,
                run["id"],
                orjson.dumps({"document_id": document_id, "reason": body.reason}).decode(),
            )
    await log_activity(
        workspace_id=row["workspace_id"],
        actor_type=auth.actor_type,
        actor_id=auth.actor_id,
        event_type="document.replaced",
        payload={"reason": body.reason},
        document_id=document_id,
        run_id=run["id"],
    )
    return {"data": {"revision_id": revision["id"], "run_id": run["id"]}}


@router.delete("/v1/documents/{document_id}")
async def archive_document(document_id: str, auth: Annotated[AuthContext, Depends(require_auth)]) -> dict:
    require_agent_write_scope(auth)
    pool = await get_db_pool()
    row = await pool.fetchrow(
        "SELECT workspace_id::text AS workspace_id, path FROM documents WHERE id = $1::uuid",
        document_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    if auth.workspace_roles and row["workspace_id"] not in auth.workspace_roles:
        raise HTTPException(status_code=403, detail="Workspace access denied")
    if row["path"] in {"/wiki/overview.md", "/wiki/log.md"}:
        raise HTTPException(status_code=409, detail="Structural documents cannot be archived")
    async with pool.acquire() as connection:
        current_content = await connection.fetchval(
            "SELECT content_md FROM document_revisions WHERE id = (SELECT current_revision_id FROM documents WHERE id = $1::uuid)",
            document_id,
        )
        async with connection.transaction():
            run = await connection.fetchrow(
                """
                INSERT INTO runs (workspace_id, run_type, status, actor_type, actor_id, input, started_at, completed_at)
                VALUES ($1::uuid, 'agent_edit', 'succeeded', $2::actor_type, $3, $4::jsonb, NOW(), NOW())
                RETURNING id::text AS id
                """,
                row["workspace_id"],
                auth.actor_type,
                auth.actor_id,
                orjson.dumps({"op": "archive_doc", "path": row["path"]}).decode(),
            )
            archive_rev = await connection.fetchrow(
                """
                INSERT INTO document_revisions (document_id, actor_type, actor_id, run_id, reason, content_md, content_ast, diff_summary)
                VALUES ($1::uuid, $2::actor_type, $3, $4::uuid, 'Archive document', $5, '{}'::jsonb, '{"op":"archive_doc"}'::jsonb)
                RETURNING id::text AS id
                """,
                document_id,
                auth.actor_type,
                auth.actor_id,
                run["id"],
                current_content or "",
            )
            await connection.execute(
                "UPDATE documents SET archived_at = NOW(), status = 'archived', current_revision_id = $2::uuid WHERE id = $1::uuid",
                document_id,
                archive_rev["id"],
            )
            await connection.execute(
                """
                INSERT INTO run_steps (run_id, step_key, status, payload, started_at, completed_at)
                VALUES ($1::uuid, 'archive_doc', 'succeeded', $2::jsonb, NOW(), NOW())
                """,
                run["id"],
                orjson.dumps({"document_id": document_id, "path": row["path"]}).decode(),
            )
    await log_activity(
        workspace_id=row["workspace_id"],
        actor_type=auth.actor_type,
        actor_id=auth.actor_id,
        event_type="document.archived",
        payload={"path": row["path"]},
        document_id=document_id,
        run_id=run["id"],
    )
    return {"data": {"archived": True}}

from __future__ import annotations

import io
import os
import re
import zipfile
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from ...core.deps import AuthContext, get_workspace_conn, require_agent_write_scope, require_auth, require_workspace_access
from ...core.rate_limit import limiter

from llm_wiki_core.db import acquire
from llm_wiki_core.markdown_ops import append_markdown, replace_exact_once
from llm_wiki_core.queue import enqueue_run
from llm_wiki_core.storage import put_bytes
from llm_wiki_core.write_journal import append_run_step, create_document, create_revision, create_run, record_activity, set_document_revision


router = APIRouter(tags=["documents"])


MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 MiB
ALLOWED_UPLOAD_EXTENSIONS = {
    "pdf",
    "docx",
    "doc",
    "pptx",
    "ppt",
    "xlsx",
    "xls",
    "csv",
    "md",
    "markdown",
    "txt",
    "html",
    "htm",
}
ALLOWED_UPLOAD_MIME_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "text/markdown",
    "text/plain",
    "text/html",
    "application/octet-stream",
}
OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
ZIP_MAGIC = b"PK\x03\x04"


def _looks_like_text(data: bytes) -> bool:
    sample = data[:4096]
    if b"\x00" in sample:
        return False
    try:
        sample.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return True


def _validate_upload_content(extension: str, data: bytes) -> None:
    if extension == "pdf":
        if not data.startswith(b"%PDF-"):
            raise HTTPException(status_code=415, detail="Uploaded content does not match PDF signature")
        return

    if extension in {"docx", "xlsx", "pptx"}:
        if not data.startswith(ZIP_MAGIC):
            raise HTTPException(status_code=415, detail="Uploaded content does not match OOXML signature")
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                names = archive.namelist()
        except zipfile.BadZipFile as exc:
            raise HTTPException(status_code=415, detail="Uploaded OOXML file is invalid") from exc
        expected_prefix = {"docx": "word/", "xlsx": "xl/", "pptx": "ppt/"}[extension]
        if not any(name.startswith(expected_prefix) for name in names):
            raise HTTPException(status_code=415, detail=f"Uploaded content does not match .{extension} structure")
        return

    if extension in {"doc", "xls", "ppt"}:
        if not data.startswith(OLE_MAGIC):
            raise HTTPException(status_code=415, detail=f"Uploaded content does not match .{extension} signature")
        return

    if extension in {"md", "markdown", "txt", "csv"}:
        if not _looks_like_text(data):
            raise HTTPException(status_code=415, detail="Uploaded text content is not valid UTF-8 text")
        return

    if extension in {"html", "htm"}:
        if not _looks_like_text(data):
            raise HTTPException(status_code=415, detail="Uploaded HTML content is not valid UTF-8 text")
        text = data[:4096].decode("utf-8", errors="ignore").lower()
        if not any(tag in text for tag in ("<html", "<body", "<!doctype html")):
            raise HTTPException(status_code=415, detail="Uploaded content does not look like HTML")
        return


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


async def _find_document_for_auth(
    document_id: str,
    auth: AuthContext,
    query: str,
):
    for workspace_id in auth.workspace_roles or {}:
        async with acquire(workspace_id) as connection:
            row = await connection.fetchrow(query, document_id)
            if row:
                return row, workspace_id
    return None, None


@router.get("/v1/workspaces/{workspace_id}/documents")
async def list_documents(
    workspace_id: str,
    auth: Annotated[AuthContext, Depends(require_workspace_access)],
    connection=Depends(get_workspace_conn),
    path_prefix: str | None = None,
    kind: str | None = None,
) -> dict:
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
    rows = await connection.fetch(sql, *params)
    return {"data": [dict(row) for row in rows]}


@router.get("/v1/workspaces/{workspace_id}/documents/by-path")
async def get_document_by_path(
    workspace_id: str,
    path: str,
    auth: Annotated[AuthContext, Depends(require_workspace_access)],
    connection=Depends(get_workspace_conn),
) -> dict:
    row = await connection.fetchrow(
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
    connection=Depends(get_workspace_conn),
) -> dict:
    require_agent_write_scope(auth)
    document_path = validate_document_path(body.path, body.kind)
    async with connection.transaction():
        document = await create_document(
            connection,
            workspace_id=workspace_id,
            kind=body.kind,
            path=document_path,
            title=body.title,
            mime_type="text/markdown",
            status="ready",
            policy=body.policy,
        )
        run = await create_run(
            connection,
            workspace_id=workspace_id,
            run_type="agent_edit",
            actor_type=auth.actor_type,
            actor_id=auth.actor_id,
            input_payload={"op": "create_doc", "path": document_path},
            status="succeeded",
            started_now=True,
            completed_now=True,
        )
        revision = await create_revision(
            connection,
            document_id=document.id,
            actor_type=auth.actor_type,
            actor_id=auth.actor_id,
            run_id=run.id,
            reason="Create document",
            content_md=body.content,
            diff_summary={"op": "create_doc"},
        )
        await set_document_revision(connection, document.id, revision.id)
        await append_run_step(connection, run.id, "create_doc", "succeeded", {"path": document_path, "title": body.title})
        await record_activity(
            workspace_id=workspace_id,
            actor_type=auth.actor_type,
            actor_id=auth.actor_id,
            event_type="document.created",
            payload={"path": document_path, "title": body.title, "kind": body.kind},
            document_id=document.id,
            run_id=run.id,
            connection=connection,
        )
    return {"data": {"document_id": document.id, "run_id": run.id, "path": document_path}}


@router.post("/v1/workspaces/{workspace_id}/documents/upload")
@limiter.limit("10/minute")
async def upload_source_document(
    request: Request,
    workspace_id: str,
    auth: Annotated[AuthContext, Depends(require_workspace_access)],
    connection=Depends(get_workspace_conn),
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    source_path: str = Form(default="/sources/"),
) -> dict:
    require_agent_write_scope(auth)
    filename = file.filename or ""
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file extension '{extension}'. Allowed: {sorted(ALLOWED_UPLOAD_EXTENSIONS)}",
        )
    content_type = (file.content_type or "application/octet-stream").split(";")[0].strip().lower()
    if content_type not in ALLOWED_UPLOAD_MIME_TYPES:
        raise HTTPException(status_code=415, detail=f"Unsupported content type '{content_type}'")
    if file.size is not None and file.size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds size limit")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds size limit")
    _validate_upload_content(extension, data)
    document_title = title or os.path.splitext(filename or "source")[0]
    path = build_document_path(normalize_path(source_path), document_title, extension or "bin")
    storage_key = f"{workspace_id}/{path.lstrip('/')}"
    put_bytes(storage_key, data, content_type)

    async with connection.transaction():
        document = await create_document(
            connection,
            workspace_id=workspace_id,
            kind="source",
            path=path,
            title=document_title,
            mime_type=file.content_type or "application/octet-stream",
            status="queued",
            policy="system_managed",
            metadata={
                "storage_key": storage_key,
                "filename": file.filename,
                "size": len(data),
                "mime_type": file.content_type or "application/octet-stream",
            },
        )
        revision = await create_revision(
            connection,
            document_id=document.id,
            actor_type=auth.actor_type,
            actor_id=auth.actor_id,
            run_id=None,
            reason="Source uploaded",
            content_md=f"Uploaded source `{file.filename}`",
            diff_summary={"op": "create_doc"},
        )
        await set_document_revision(connection, document.id, revision.id)
        run = await create_run(
            connection,
            workspace_id=workspace_id,
            run_type="ingest",
            actor_type=auth.actor_type,
            actor_id=auth.actor_id,
            input_payload={"document_id": document.id},
        )
        await record_activity(
            workspace_id=workspace_id,
            actor_type=auth.actor_type,
            actor_id=auth.actor_id,
            event_type="source.uploaded",
            payload={"path": path, "filename": file.filename, "size": len(data)},
            document_id=document.id,
            run_id=run.id,
            connection=connection,
        )
    idem_key = f"{workspace_id}:{document.id}"
    await enqueue_run(run.id, workspace_id=workspace_id, idempotency_key=idem_key)
    return {"data": {"document_id": document.id, "run_id": run.id, "path": path}}


@router.get("/v1/documents/{document_id}")
async def get_document(document_id: str, auth: Annotated[AuthContext, Depends(require_auth)]) -> dict:
    row, _ = await _find_document_for_auth(
        document_id,
        auth,
        """
        SELECT d.id::text AS id, d.workspace_id::text AS workspace_id, d.kind::text AS kind, d.path, d.title,
               d.mime_type, d.status::text AS status, d.policy::text AS policy, d.metadata,
               dr.content_md, d.updated_at
        FROM documents d
        LEFT JOIN document_revisions dr ON dr.id = d.current_revision_id
        WHERE d.id = $1::uuid
        """,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"data": dict(row)}


@router.get("/v1/documents/{document_id}/pages")
async def get_document_pages(document_id: str, auth: Annotated[AuthContext, Depends(require_auth)]) -> dict:
    row, workspace_id = await _find_document_for_auth(
        document_id,
        auth,
        "SELECT id::text AS id FROM documents WHERE id = $1::uuid",
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    async with acquire(workspace_id) as connection:
        rows = await connection.fetch(
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
    row, workspace_id = await _find_document_for_auth(
        document_id,
        auth,
        "SELECT id::text AS id FROM documents WHERE id = $1::uuid",
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    async with acquire(workspace_id) as connection:
        rows = await connection.fetch(
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
    row, workspace_id = await _find_document_for_auth(
        document_id,
        auth,
        "SELECT id::text AS id FROM documents WHERE id = $1::uuid",
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    async with acquire(workspace_id) as connection:
        rows = await connection.fetch(
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
    row, workspace_id = await _find_document_for_auth(
        document_id,
        auth,
        "SELECT id::text AS id FROM documents WHERE id = $1::uuid",
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    async with acquire(workspace_id) as connection:
        rows = await connection.fetch(
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
    row, workspace_id = await _find_document_for_auth(
        document_id,
        auth,
        """
        SELECT d.id::text AS id, d.workspace_id::text AS workspace_id, d.policy::text AS policy, dr.content_md
        FROM documents d
        LEFT JOIN document_revisions dr ON dr.id = d.current_revision_id
        WHERE d.id = $1::uuid
        """,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    if row["policy"] == "locked":
        raise HTTPException(status_code=409, detail="Document is locked")
    new_content = append_markdown(row["content_md"] or "", body.content)
    async with acquire(workspace_id) as conn:
        async with conn.transaction():
            run = await create_run(
                conn,
                workspace_id=row["workspace_id"],
                run_type="agent_edit",
                actor_type=auth.actor_type,
                actor_id=auth.actor_id,
                input_payload={"op": "append_content", "document_id": document_id},
                status="succeeded",
                started_now=True,
                completed_now=True,
            )
            revision = await create_revision(
                conn,
                document_id=document_id,
                actor_type=auth.actor_type,
                actor_id=auth.actor_id,
                run_id=run.id,
                reason=body.reason,
                content_md=new_content,
                diff_summary={"op": "append_content"},
            )
            await set_document_revision(conn, document_id, revision.id)
            await append_run_step(conn, run.id, "append_content", "succeeded", {"document_id": document_id, "reason": body.reason})
            await record_activity(
                workspace_id=row["workspace_id"],
                actor_type=auth.actor_type,
                actor_id=auth.actor_id,
                event_type="document.appended",
                payload={"reason": body.reason},
                document_id=document_id,
                run_id=run.id,
                connection=conn,
            )
    return {"data": {"revision_id": revision.id, "run_id": run.id}}


@router.post("/v1/documents/{document_id}/replace")
async def replace_document_content(
    document_id: str,
    body: ReplaceRequest,
    auth: Annotated[AuthContext, Depends(require_auth)],
) -> dict:
    require_agent_write_scope(auth)
    row, workspace_id = await _find_document_for_auth(
        document_id,
        auth,
        """
        SELECT d.id::text AS id, d.workspace_id::text AS workspace_id, d.policy::text AS policy, dr.content_md
        FROM documents d
        LEFT JOIN document_revisions dr ON dr.id = d.current_revision_id
        WHERE d.id = $1::uuid
        """,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    if row["policy"] in {"locked", "append_only"}:
        raise HTTPException(status_code=409, detail="Document policy forbids replace")
    result = replace_exact_once(row["content_md"] or "", body.old_text, body.new_text)
    if result.occurrences == 0:
        raise HTTPException(status_code=400, detail="No matching text found")
    if result.occurrences > 1:
        raise HTTPException(status_code=400, detail="Replacement must match exactly once")
    async with acquire(workspace_id) as conn:
        async with conn.transaction():
            run = await create_run(
                conn,
                workspace_id=row["workspace_id"],
                run_type="agent_edit",
                actor_type=auth.actor_type,
                actor_id=auth.actor_id,
                input_payload={"op": "replace_section", "document_id": document_id},
                status="succeeded",
                started_now=True,
                completed_now=True,
            )
            revision = await create_revision(
                conn,
                document_id=document_id,
                actor_type=auth.actor_type,
                actor_id=auth.actor_id,
                run_id=run.id,
                reason=body.reason,
                content_md=result.content,
                diff_summary={"op": "replace_section"},
            )
            await set_document_revision(conn, document_id, revision.id)
            await append_run_step(conn, run.id, "replace_section", "succeeded", {"document_id": document_id, "reason": body.reason})
            await record_activity(
                workspace_id=row["workspace_id"],
                actor_type=auth.actor_type,
                actor_id=auth.actor_id,
                event_type="document.replaced",
                payload={"reason": body.reason},
                document_id=document_id,
                run_id=run.id,
                connection=conn,
            )
    return {"data": {"revision_id": revision.id, "run_id": run.id}}


@router.delete("/v1/documents/{document_id}")
async def archive_document(document_id: str, auth: Annotated[AuthContext, Depends(require_auth)]) -> dict:
    require_agent_write_scope(auth)
    row, workspace_id = await _find_document_for_auth(
        document_id,
        auth,
        "SELECT workspace_id::text AS workspace_id, path FROM documents WHERE id = $1::uuid",
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    if row["path"] in {"/wiki/overview.md", "/wiki/log.md"}:
        raise HTTPException(status_code=409, detail="Structural documents cannot be archived")
    async with acquire(workspace_id) as connection:
        current_content = await connection.fetchval(
            "SELECT content_md FROM document_revisions WHERE id = (SELECT current_revision_id FROM documents WHERE id = $1::uuid)",
            document_id,
        )
        async with connection.transaction():
            run = await create_run(
                connection,
                workspace_id=row["workspace_id"],
                run_type="agent_edit",
                actor_type=auth.actor_type,
                actor_id=auth.actor_id,
                input_payload={"op": "archive_doc", "path": row["path"]},
                status="succeeded",
                started_now=True,
                completed_now=True,
            )
            archive_rev = await create_revision(
                connection,
                document_id=document_id,
                actor_type=auth.actor_type,
                actor_id=auth.actor_id,
                run_id=run.id,
                reason="Archive document",
                content_md=current_content or "",
                diff_summary={"op": "archive_doc"},
            )
            await set_document_revision(connection, document_id, archive_rev.id, status="archived", archived=True)
            await append_run_step(connection, run.id, "archive_doc", "succeeded", {"document_id": document_id, "path": row["path"]})
            await record_activity(
                workspace_id=row["workspace_id"],
                actor_type=auth.actor_type,
                actor_id=auth.actor_id,
                event_type="document.archived",
                payload={"path": row["path"]},
                document_id=document_id,
                run_id=run.id,
                connection=connection,
            )
    return {"data": {"archived": True}}

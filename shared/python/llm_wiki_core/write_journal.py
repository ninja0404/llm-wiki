from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .audit import log_activity


@dataclass(slots=True)
class RunRecord:
    id: str


@dataclass(slots=True)
class RevisionRecord:
    id: str


@dataclass(slots=True)
class DocumentRecord:
    id: str


async def create_document(
    connection,
    workspace_id: str,
    kind: str,
    path: str,
    title: str,
    mime_type: str,
    status: str,
    policy: str,
    metadata: dict[str, Any] | None = None,
) -> DocumentRecord:
    row = await connection.fetchrow(
        """
        INSERT INTO documents (workspace_id, kind, path, title, mime_type, status, policy, metadata)
        VALUES ($1::uuid, $2::document_kind, $3, $4, $5, $6::document_status, $7::document_policy, $8::jsonb)
        RETURNING id::text AS id
        """,
        workspace_id,
        kind,
        path,
        title,
        mime_type,
        status,
        policy,
        metadata or {},
    )
    return DocumentRecord(id=row["id"])


async def create_run(
    connection,
    workspace_id: str,
    run_type: str,
    actor_type: str,
    actor_id: str | None,
    input_payload: dict[str, Any] | None = None,
    *,
    status: str = "queued",
    started_now: bool = False,
    completed_now: bool = False,
    output_payload: dict[str, Any] | None = None,
    error_message: str | None = None,
) -> RunRecord:
    row = await connection.fetchrow(
        """
        INSERT INTO runs (
            workspace_id, run_type, status, actor_type, actor_id, input, output, error_message, started_at, completed_at
        )
        VALUES (
            $1::uuid, $2::run_type, $3::run_status, $4::actor_type, $5, $6::jsonb, $7::jsonb, $8,
            CASE WHEN $9 THEN NOW() ELSE NULL END,
            CASE WHEN $10 THEN NOW() ELSE NULL END
        )
        RETURNING id::text AS id
        """,
        workspace_id,
        run_type,
        status,
        actor_type,
        actor_id,
        input_payload or {},
        output_payload or {},
        error_message,
        started_now,
        completed_now,
    )
    return RunRecord(id=row["id"])


async def update_run(
    connection,
    run_id: str,
    *,
    status: str | None = None,
    output_payload: dict[str, Any] | None = None,
    error_message: str | None = None,
    started_now: bool = False,
    completed_now: bool = False,
) -> None:
    await connection.execute(
        """
        UPDATE runs
        SET status = COALESCE($2::run_status, status),
            output = CASE WHEN $3::jsonb IS NULL THEN output ELSE $3::jsonb END,
            error_message = COALESCE($4, error_message),
            started_at = CASE WHEN $5 THEN COALESCE(started_at, NOW()) ELSE started_at END,
            completed_at = CASE WHEN $6 THEN NOW() ELSE completed_at END
        WHERE id = $1::uuid
        """,
        run_id,
        status,
        output_payload,
        error_message,
        started_now,
        completed_now,
    )


async def append_run_step(
    connection,
    run_id: str,
    step_key: str,
    status: str,
    payload: dict[str, Any] | None = None,
    error_message: str | None = None,
) -> None:
    await connection.execute(
        """
        INSERT INTO run_steps (run_id, step_key, status, payload, error_message, started_at, completed_at)
        VALUES ($1::uuid, $2, $3::run_status, $4::jsonb, $5, NOW(), NOW())
        """,
        run_id,
        step_key,
        status,
        payload or {},
        error_message,
    )


async def create_revision(
    connection,
    document_id: str,
    actor_type: str,
    actor_id: str | None,
    run_id: str | None,
    reason: str,
    content_md: str,
    diff_summary: dict[str, Any] | None = None,
    content_ast: dict[str, Any] | None = None,
) -> RevisionRecord:
    row = await connection.fetchrow(
        """
        INSERT INTO document_revisions (document_id, actor_type, actor_id, run_id, reason, content_md, content_ast, diff_summary)
        VALUES ($1::uuid, $2::actor_type, $3, $4::uuid, $5, $6, $7::jsonb, $8::jsonb)
        RETURNING id::text AS id
        """,
        document_id,
        actor_type,
        actor_id,
        run_id,
        reason,
        content_md,
        content_ast or {},
        diff_summary or {},
    )
    return RevisionRecord(id=row["id"])


async def set_document_revision(
    connection,
    document_id: str,
    revision_id: str,
    *,
    status: str | None = None,
    archived: bool = False,
) -> None:
    await connection.execute(
        """
        UPDATE documents
        SET current_revision_id = $2::uuid,
            status = COALESCE($3::document_status, status),
            archived_at = CASE WHEN $4 THEN NOW() ELSE archived_at END
        WHERE id = $1::uuid
        """,
        document_id,
        revision_id,
        status,
        archived,
    )


async def record_activity(
    *,
    workspace_id: str,
    actor_type: str,
    actor_id: str | None,
    event_type: str,
    payload: dict[str, Any] | None = None,
    document_id: str | None = None,
    run_id: str | None = None,
    connection=None,
) -> None:
    await log_activity(
        workspace_id=workspace_id,
        actor_type=actor_type,
        actor_id=actor_id,
        event_type=event_type,
        payload=payload,
        document_id=document_id,
        run_id=run_id,
        connection=connection,
    )

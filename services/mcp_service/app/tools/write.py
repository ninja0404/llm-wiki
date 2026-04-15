from __future__ import annotations

import orjson
from mcp.server.fastmcp import FastMCP

from llm_wiki_core.db import get_db_pool
from llm_wiki_core.markdown_ops import append_markdown, replace_exact_once

from llm_wiki_core.audit import log_activity
from llm_wiki_core.queue import enqueue_run

from ..core.auth import validate_agent


def register_write_tools(mcp: FastMCP) -> None:
    @mcp.tool(name="create", description="Create a new wiki or asset document inside the workspace vault.")
    async def create(
        workspace_id: str,
        agent_token: str,
        path: str,
        title: str,
        content: str,
        tags: list[str] | None = None,
        kind: str = "wiki",
    ) -> str:
        ctx = await validate_agent(workspace_id, agent_token, "create")
        if kind not in {"wiki", "asset"}:
            return f"Invalid kind `{kind}`. Must be 'wiki' or 'asset'."
        path = path.strip()
        if not path.startswith("/"):
            path = "/" + path
        if path.endswith("/"):
            return f"Invalid path `{path}`. Must be a file path, not a directory."
        if kind == "wiki" and not path.endswith(".md"):
            return f"Invalid path `{path}`. Wiki document path must end with '.md'."
        pool = await get_db_pool()
        final_path = path
        async with pool.acquire() as connection:
            async with connection.transaction():
                document = await connection.fetchrow(
                    """
                    INSERT INTO documents (workspace_id, kind, path, title, mime_type, status, policy, metadata)
                    VALUES ($1::uuid, $2::document_kind, $3, $4, 'text/markdown', 'ready', 'agent_editable', $5::jsonb)
                    RETURNING id::text AS id
                    """,
                    workspace_id,
                    kind,
                    final_path,
                    title,
                    {"tags": tags or []},
                )
                run = await connection.fetchrow(
                    """
                    INSERT INTO runs (workspace_id, run_type, actor_type, actor_id, input)
                    VALUES ($1::uuid, 'agent_edit', 'agent', $2, $3::jsonb)
                    RETURNING id::text AS id
                    """,
                    workspace_id,
                    ctx.token_id,
                    orjson.dumps({"op": "create_doc", "path": final_path}).decode(),
                )
                revision = await connection.fetchrow(
                    """
                    INSERT INTO document_revisions (document_id, actor_type, actor_id, run_id, reason, content_md, content_ast, diff_summary)
                    VALUES ($1::uuid, 'agent', $2, $3::uuid, 'Create document', $4, '{}'::jsonb, '{"op":"create_doc"}'::jsonb)
                    RETURNING id::text AS id
                    """,
                    document["id"],
                    ctx.token_id,
                    run["id"],
                    content,
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
                    orjson.dumps({"path": final_path, "title": title}).decode(),
                )
                await connection.execute(
                    "UPDATE runs SET status = 'succeeded', completed_at = NOW() WHERE id = $1::uuid",
                    run["id"],
                )
        await log_activity(
            workspace_id=workspace_id,
            actor_type="agent",
            actor_id=ctx.token_id,
            event_type="document.created",
            payload={"path": final_path, "title": title, "kind": kind},
            document_id=document["id"],
            run_id=run["id"],
        )
        return f"Created `{final_path}`."

    @mcp.tool(name="replace", description="Replace an exact string once inside a writable document.")
    async def replace(
        workspace_id: str,
        agent_token: str,
        path: str,
        old_text: str,
        new_text: str,
    ) -> str:
        ctx = await validate_agent(workspace_id, agent_token, "replace")
        pool = await get_db_pool()
        normalized = path if path.startswith("/") else f"/{path}"
        row = await pool.fetchrow(
            """
            SELECT d.id::text AS id, d.policy::text AS policy, dr.content_md
            FROM documents d
            JOIN document_revisions dr ON dr.id = d.current_revision_id
            WHERE d.workspace_id = $1::uuid AND d.path = $2 AND d.archived_at IS NULL
            """,
            workspace_id,
            normalized,
        )
        if not row:
            return f"Document `{path}` not found."
        if row["policy"] in {"system_managed", "append_only", "locked"}:
            return f"Document `{path}` policy '{row['policy']}' does not allow replace."
        result = replace_exact_once(row["content_md"], old_text, new_text)
        if result.occurrences != 1:
            return f"Expected exactly one match, got {result.occurrences}."
        async with pool.acquire() as conn:
            async with conn.transaction():
                run = await conn.fetchrow(
                    """
                    INSERT INTO runs (workspace_id, run_type, actor_type, actor_id, input)
                    VALUES ($1::uuid, 'agent_edit', 'agent', $2, $3::jsonb)
                    RETURNING id::text AS id
                    """,
                    workspace_id,
                    ctx.token_id,
                    orjson.dumps({"op": "replace_section", "path": normalized}).decode(),
                )
                revision = await conn.fetchrow(
                    """
                    INSERT INTO document_revisions (document_id, actor_type, actor_id, run_id, reason, content_md, content_ast, diff_summary)
                    VALUES ($1::uuid, 'agent', $2, $3::uuid, 'Replace exact text', $4, '{}'::jsonb, '{"op":"replace_section"}'::jsonb)
                    RETURNING id::text AS id
                    """,
                    row["id"],
                    ctx.token_id,
                    run["id"],
                    result.content,
                )
                await conn.execute("UPDATE documents SET current_revision_id = $1::uuid WHERE id = $2::uuid", revision["id"], row["id"])
                await conn.execute(
                    """
                    INSERT INTO run_steps (run_id, step_key, status, payload, started_at, completed_at)
                    VALUES ($1::uuid, 'replace_section', 'succeeded', $2::jsonb, NOW(), NOW())
                    """,
                    run["id"],
                    orjson.dumps({"path": normalized}).decode(),
                )
                await conn.execute("UPDATE runs SET status = 'succeeded', completed_at = NOW() WHERE id = $1::uuid", run["id"])
        await log_activity(
            workspace_id=workspace_id,
            actor_type="agent",
            actor_id=ctx.token_id,
            event_type="document.replaced",
            payload={"path": normalized},
            document_id=row["id"],
            run_id=run["id"],
        )
        return f"Updated `{path}`."

    @mcp.tool(name="append", description="Append markdown content to an existing document.")
    async def append(
        workspace_id: str,
        agent_token: str,
        path: str,
        content: str,
    ) -> str:
        ctx = await validate_agent(workspace_id, agent_token, "append")
        pool = await get_db_pool()
        normalized = path if path.startswith("/") else f"/{path}"
        row = await pool.fetchrow(
            """
            SELECT d.id::text AS id, d.policy::text AS policy, dr.content_md
            FROM documents d
            JOIN document_revisions dr ON dr.id = d.current_revision_id
            WHERE d.workspace_id = $1::uuid AND d.path = $2 AND d.archived_at IS NULL
            """,
            workspace_id,
            normalized,
        )
        if not row:
            return f"Document `{path}` not found."
        if row["policy"] in {"system_managed", "locked"}:
            return f"Document `{path}` policy '{row['policy']}' does not allow agent append."
        async with pool.acquire() as conn:
            async with conn.transaction():
                run = await conn.fetchrow(
                    """
                    INSERT INTO runs (workspace_id, run_type, actor_type, actor_id, input)
                    VALUES ($1::uuid, 'agent_edit', 'agent', $2, $3::jsonb)
                    RETURNING id::text AS id
                    """,
                    workspace_id,
                    ctx.token_id,
                    orjson.dumps({"op": "append_content", "path": normalized}).decode(),
                )
                revision = await conn.fetchrow(
                    """
                    INSERT INTO document_revisions (document_id, actor_type, actor_id, run_id, reason, content_md, content_ast, diff_summary)
                    VALUES ($1::uuid, 'agent', $2, $3::uuid, 'Append content', $4, '{}'::jsonb, '{"op":"append_content"}'::jsonb)
                    RETURNING id::text AS id
                    """,
                    row["id"],
                    ctx.token_id,
                    run["id"],
                    append_markdown(row["content_md"], content),
                )
                await conn.execute("UPDATE documents SET current_revision_id = $1::uuid WHERE id = $2::uuid", revision["id"], row["id"])
                await conn.execute(
                    """
                    INSERT INTO run_steps (run_id, step_key, status, payload, started_at, completed_at)
                    VALUES ($1::uuid, 'append_content', 'succeeded', $2::jsonb, NOW(), NOW())
                    """,
                    run["id"],
                    orjson.dumps({"path": normalized}).decode(),
                )
                await conn.execute("UPDATE runs SET status = 'succeeded', completed_at = NOW() WHERE id = $1::uuid", run["id"])
        await log_activity(
            workspace_id=workspace_id,
            actor_type="agent",
            actor_id=ctx.token_id,
            event_type="document.appended",
            payload={"path": normalized},
            document_id=row["id"],
            run_id=run["id"],
        )
        return f"Appended to `{path}`."

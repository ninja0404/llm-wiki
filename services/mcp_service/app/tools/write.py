from __future__ import annotations
from mcp.server.fastmcp import FastMCP

from llm_wiki_core.db import acquire
from llm_wiki_core.markdown_ops import append_markdown, replace_exact_once
from llm_wiki_core.write_journal import append_run_step, create_document, create_revision, create_run, record_activity, set_document_revision

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
        final_path = path
        async with acquire(workspace_id) as connection:
            async with connection.transaction():
                document = await create_document(
                    connection,
                    workspace_id=workspace_id,
                    kind=kind,
                    path=final_path,
                    title=title,
                    mime_type="text/markdown",
                    status="ready",
                    policy="agent_editable",
                    metadata={"tags": tags or []},
                )
                run = await create_run(
                    connection,
                    workspace_id=workspace_id,
                    run_type="agent_edit",
                    actor_type="agent",
                    actor_id=ctx.token_id,
                    input_payload={"op": "create_doc", "path": final_path},
                    status="succeeded",
                    started_now=True,
                    completed_now=True,
                )
                revision = await create_revision(
                    connection,
                    document_id=document.id,
                    actor_type="agent",
                    actor_id=ctx.token_id,
                    run_id=run.id,
                    reason="Create document",
                    content_md=content,
                    diff_summary={"op": "create_doc"},
                )
                await set_document_revision(connection, document.id, revision.id)
                await append_run_step(connection, run.id, "create_doc", "succeeded", {"path": final_path, "title": title})
                await record_activity(
                    workspace_id=workspace_id,
                    actor_type="agent",
                    actor_id=ctx.token_id,
                    event_type="document.created",
                    payload={"path": final_path, "title": title, "kind": kind},
                    document_id=document.id,
                    run_id=run.id,
                    connection=connection,
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
        normalized = path if path.startswith("/") else f"/{path}"
        async with acquire(workspace_id) as conn:
            row = await conn.fetchrow(
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
            async with conn.transaction():
                run = await create_run(
                    conn,
                    workspace_id=workspace_id,
                    run_type="agent_edit",
                    actor_type="agent",
                    actor_id=ctx.token_id,
                    input_payload={"op": "replace_section", "path": normalized},
                    status="succeeded",
                    started_now=True,
                    completed_now=True,
                )
                revision = await create_revision(
                    conn,
                    document_id=row["id"],
                    actor_type="agent",
                    actor_id=ctx.token_id,
                    run_id=run.id,
                    reason="Replace exact text",
                    content_md=result.content,
                    diff_summary={"op": "replace_section"},
                )
                await set_document_revision(conn, row["id"], revision.id)
                await append_run_step(conn, run.id, "replace_section", "succeeded", {"path": normalized})
                await record_activity(
                    workspace_id=workspace_id,
                    actor_type="agent",
                    actor_id=ctx.token_id,
                    event_type="document.replaced",
                    payload={"path": normalized},
                    document_id=row["id"],
                    run_id=run.id,
                    connection=conn,
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
        normalized = path if path.startswith("/") else f"/{path}"
        async with acquire(workspace_id) as conn:
            row = await conn.fetchrow(
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
            async with conn.transaction():
                run = await create_run(
                    conn,
                    workspace_id=workspace_id,
                    run_type="agent_edit",
                    actor_type="agent",
                    actor_id=ctx.token_id,
                    input_payload={"op": "append_content", "path": normalized},
                    status="succeeded",
                    started_now=True,
                    completed_now=True,
                )
                revision = await create_revision(
                    conn,
                    document_id=row["id"],
                    actor_type="agent",
                    actor_id=ctx.token_id,
                    run_id=run.id,
                    reason="Append content",
                    content_md=append_markdown(row["content_md"], content),
                    diff_summary={"op": "append_content"},
                )
                await set_document_revision(conn, row["id"], revision.id)
                await append_run_step(conn, run.id, "append_content", "succeeded", {"path": normalized})
                await record_activity(
                    workspace_id=workspace_id,
                    actor_type="agent",
                    actor_id=ctx.token_id,
                    event_type="document.appended",
                    payload={"path": normalized},
                    document_id=row["id"],
                    run_id=run.id,
                    connection=conn,
                )
        return f"Appended to `{path}`."

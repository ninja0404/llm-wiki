from mcp.server.fastmcp import FastMCP

from llm_wiki_core.db import acquire
from llm_wiki_core.write_journal import append_run_step, create_revision, create_run, record_activity, set_document_revision

from ..core.auth import validate_agent

PROTECTED_PATHS = {"/wiki/overview.md", "/wiki/log.md"}


def register_delete_tool(mcp: FastMCP) -> None:
    @mcp.tool(name="delete", description="Archive a non-structural document by path.")
    async def delete(workspace_id: str, agent_token: str, path: str) -> str:
        ctx = await validate_agent(workspace_id, agent_token, "delete")
        normalized_path = path if path.startswith("/") else f"/{path}"
        if normalized_path in PROTECTED_PATHS:
            return f"`{normalized_path}` is protected."
        async with acquire(workspace_id) as conn:
            row = await conn.fetchrow(
                """
                SELECT id::text AS id, policy::text AS policy
                FROM documents
                WHERE workspace_id = $1::uuid AND path = $2 AND archived_at IS NULL
                """,
                workspace_id,
                normalized_path,
            )
            if not row:
                return f"Document `{normalized_path}` not found."
            if row["policy"] in {"system_managed", "locked"}:
                return f"Document `{normalized_path}` policy '{row['policy']}' does not allow archiving."
            current_content = await conn.fetchval(
                "SELECT content_md FROM document_revisions WHERE id = (SELECT current_revision_id FROM documents WHERE id = $1::uuid)",
                row["id"],
            )
            async with conn.transaction():
                run = await create_run(
                    conn,
                    workspace_id=workspace_id,
                    run_type="agent_edit",
                    actor_type="agent",
                    actor_id=ctx.token_id,
                    input_payload={"op": "archive_doc", "path": normalized_path},
                    status="succeeded",
                    started_now=True,
                    completed_now=True,
                )
                archive_rev = await create_revision(
                    conn,
                    document_id=row["id"],
                    actor_type="agent",
                    actor_id=ctx.token_id,
                    run_id=run.id,
                    reason="Archive document",
                    content_md=current_content or "",
                    diff_summary={"op": "archive_doc"},
                )
                await set_document_revision(conn, row["id"], archive_rev.id, status="archived", archived=True)
                await append_run_step(conn, run.id, "archive_doc", "succeeded", {"path": normalized_path})
                await record_activity(
                    workspace_id=workspace_id,
                    actor_type="agent",
                    actor_id=ctx.token_id,
                    event_type="document.archived",
                    payload={"path": normalized_path},
                    document_id=row["id"],
                    run_id=run.id,
                    connection=conn,
                )
        return "Archived."

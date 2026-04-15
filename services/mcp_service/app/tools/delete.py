import orjson
from mcp.server.fastmcp import FastMCP

from llm_wiki_core.audit import log_activity
from llm_wiki_core.db import get_db_pool

from ..core.auth import validate_agent

PROTECTED_PATHS = {"/wiki/overview.md", "/wiki/log.md"}


def register_delete_tool(mcp: FastMCP) -> None:
    @mcp.tool(name="delete", description="Archive a non-structural document by path.")
    async def delete(workspace_id: str, agent_token: str, path: str) -> str:
        ctx = await validate_agent(workspace_id, agent_token, "delete")
        normalized_path = path if path.startswith("/") else f"/{path}"
        if normalized_path in PROTECTED_PATHS:
            return f"`{normalized_path}` is protected."
        pool = await get_db_pool()
        row = await pool.fetchrow(
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
        current_content = await pool.fetchval(
            "SELECT content_md FROM document_revisions WHERE id = (SELECT current_revision_id FROM documents WHERE id = $1::uuid)",
            row["id"],
        )
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
                    orjson.dumps({"op": "archive_doc", "path": normalized_path}).decode(),
                )
                archive_rev = await conn.fetchrow(
                    """
                    INSERT INTO document_revisions (document_id, actor_type, actor_id, run_id, reason, content_md, content_ast, diff_summary)
                    VALUES ($1::uuid, 'agent', $2, $3::uuid, 'Archive document', $4, '{}'::jsonb, '{"op":"archive_doc"}'::jsonb)
                    RETURNING id::text AS id
                    """,
                    row["id"],
                    ctx.token_id,
                    run["id"],
                    current_content or "",
                )
                await conn.execute(
                    "UPDATE documents SET archived_at = NOW(), status = 'archived', current_revision_id = $2::uuid WHERE id = $1::uuid",
                    row["id"],
                    archive_rev["id"],
                )
                await conn.execute(
                    """
                    INSERT INTO run_steps (run_id, step_key, status, payload, started_at, completed_at)
                    VALUES ($1::uuid, 'archive_doc', 'succeeded', $2::jsonb, NOW(), NOW())
                    """,
                    run["id"],
                    orjson.dumps({"path": normalized_path}).decode(),
                )
                await conn.execute(
                    "UPDATE runs SET status = 'succeeded', completed_at = NOW() WHERE id = $1::uuid",
                    run["id"],
                )
        await log_activity(
            workspace_id=workspace_id,
            actor_type="agent",
            actor_id=ctx.token_id,
            event_type="document.archived",
            payload={"path": normalized_path},
            document_id=row["id"],
            run_id=run["id"],
        )
        return "Archived."

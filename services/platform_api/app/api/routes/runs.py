from typing import Annotated

from fastapi import APIRouter, Depends

from ...core.deps import AuthContext, require_auth, require_workspace_access
from llm_wiki_core.db import get_db_pool


router = APIRouter(tags=["runs"])


@router.get("/v1/workspaces/{workspace_id}/runs")
async def list_runs(
    workspace_id: str,
    auth: Annotated[AuthContext, Depends(require_workspace_access)],
) -> dict:
    pool = await get_db_pool()
    runs = await pool.fetch(
        """
        SELECT id::text AS id, run_type::text AS run_type, status::text AS status,
               actor_type::text AS actor_type, actor_id, input, output, error_message,
               started_at, completed_at, created_at
        FROM runs
        WHERE workspace_id = $1::uuid
        ORDER BY created_at DESC
        LIMIT 100
        """,
        workspace_id,
    )
    return {"data": [dict(row) for row in runs]}


@router.get("/v1/runs/{run_id}/steps")
async def list_run_steps(run_id: str, auth: Annotated[AuthContext, Depends(require_auth)]) -> dict:
    pool = await get_db_pool()
    workspace_id = await pool.fetchval("SELECT workspace_id::text FROM runs WHERE id = $1::uuid", run_id)
    if not workspace_id:
        return {"data": []}
    if auth.workspace_roles and workspace_id not in auth.workspace_roles:
        return {"data": []}
    rows = await pool.fetch(
        """
        SELECT id::text AS id, step_key, status::text AS status, payload, error_message, started_at, completed_at, created_at
        FROM run_steps
        WHERE run_id = $1::uuid
        ORDER BY created_at ASC
        """,
        run_id,
    )
    return {"data": [dict(row) for row in rows]}


@router.get("/v1/runs/{run_id}")
async def get_run(run_id: str, auth: Annotated[AuthContext, Depends(require_auth)]) -> dict:
    pool = await get_db_pool()
    row = await pool.fetchrow(
        """
        SELECT id::text AS id, workspace_id::text AS workspace_id, run_type::text AS run_type, status::text AS status,
               actor_type::text AS actor_type, actor_id, input, output, error_message,
               started_at, completed_at, created_at
        FROM runs
        WHERE id = $1::uuid
        """,
        run_id,
    )
    if not row:
        return {"data": None}
    if auth.workspace_roles and row["workspace_id"] not in auth.workspace_roles:
        return {"data": None}
    return {"data": dict(row)}

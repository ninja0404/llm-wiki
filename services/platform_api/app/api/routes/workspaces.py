from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...core.deps import AuthContext, require_auth
from ...services.workspace import bootstrap_workspace
from llm_wiki_core.db import get_db_pool


router = APIRouter(prefix="/v1/workspaces", tags=["workspaces"])


class WorkspaceCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None


@router.get("")
async def list_workspaces(auth: Annotated[AuthContext, Depends(require_auth)]) -> dict:
    pool = await get_db_pool()
    rows = await pool.fetch(
        """
        SELECT w.id::text AS id, w.slug, w.name, w.description, om.role::text AS role
        FROM workspaces w
        JOIN organizations o ON o.id = w.organization_id
        JOIN organization_members om ON om.organization_id = o.id
        WHERE om.user_id = $1::uuid
        ORDER BY w.created_at DESC
        """,
        auth.user_id,
    )
    return {"data": [dict(row) for row in rows]}


@router.post("")
async def create_workspace(
    body: WorkspaceCreateRequest,
    auth: Annotated[AuthContext, Depends(require_auth)],
) -> dict:
    if auth.actor_type != "human" or not auth.organization_id:
        raise HTTPException(status_code=403, detail="Only human users can create workspaces")
    workspace_id = await bootstrap_workspace(auth.organization_id, body.name, body.description)
    return {"data": {"workspace_id": workspace_id}}

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...core.deps import AuthContext, create_workspace_agent_token, require_workspace_access
from llm_wiki_core.audit import log_activity
from llm_wiki_core.db import get_db_pool


router = APIRouter(tags=["agent-tokens"])


VALID_TOKEN_SCOPES = {"read", "write", "admin"}


class AgentTokenCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    scope: str = "write"


@router.get("/v1/workspaces/{workspace_id}/agent-tokens")
async def list_agent_tokens(
    workspace_id: str,
    auth: Annotated[AuthContext, Depends(require_workspace_access)],
) -> dict:
    if auth.actor_type != "human":
        raise HTTPException(status_code=403, detail="Only human users can manage tokens")
    pool = await get_db_pool()
    rows = await pool.fetch(
        """
        SELECT id::text AS id, name, token_prefix, scope, last_used_at, created_at
        FROM agent_tokens
        WHERE workspace_id = $1::uuid AND revoked_at IS NULL
        ORDER BY created_at DESC
        """,
        workspace_id,
    )
    return {"data": [dict(row) for row in rows]}


@router.post("/v1/workspaces/{workspace_id}/agent-tokens")
async def create_agent_token(
    workspace_id: str,
    body: AgentTokenCreateRequest,
    auth: Annotated[AuthContext, Depends(require_workspace_access)],
) -> dict:
    if auth.actor_type != "human" or not auth.user_id:
        raise HTTPException(status_code=403, detail="Only human users can create agent tokens")
    if body.scope not in VALID_TOKEN_SCOPES:
        raise HTTPException(status_code=400, detail=f"Invalid scope '{body.scope}'. Must be one of: {', '.join(sorted(VALID_TOKEN_SCOPES))}")
    token = await create_workspace_agent_token(workspace_id, auth.user_id, body.name, body.scope)
    await log_activity(
        workspace_id=workspace_id,
        actor_type="human",
        actor_id=auth.user_id,
        event_type="agent_token.created",
        payload={"name": body.name, "scope": body.scope, "token_prefix": token["token_prefix"]},
    )
    return {"data": token}


@router.delete("/v1/workspaces/{workspace_id}/agent-tokens/{token_id}")
async def revoke_agent_token(
    workspace_id: str,
    token_id: str,
    auth: Annotated[AuthContext, Depends(require_workspace_access)],
) -> dict:
    if auth.actor_type != "human":
        raise HTTPException(status_code=403, detail="Only human users can revoke agent tokens")
    pool = await get_db_pool()
    await pool.execute(
        """
        UPDATE agent_tokens
        SET revoked_at = NOW()
        WHERE id = $1::uuid AND workspace_id = $2::uuid
        """,
        token_id,
        workspace_id,
    )
    await log_activity(
        workspace_id=workspace_id,
        actor_type="human",
        actor_id=auth.user_id,
        event_type="agent_token.revoked",
        payload={"token_id": token_id},
    )
    return {"data": {"revoked": True}}

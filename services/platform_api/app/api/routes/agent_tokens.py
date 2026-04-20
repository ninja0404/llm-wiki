from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...core.deps import AuthContext, create_workspace_agent_token, get_workspace_conn, require_workspace_access
from llm_wiki_core.audit import log_activity


router = APIRouter(tags=["agent-tokens"])


VALID_TOKEN_SCOPES = {"read", "write", "admin"}


DEFAULT_TOKEN_TTL_DAYS = 90


class AgentTokenCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    scope: str = "write"
    expires_in_days: int = Field(default=DEFAULT_TOKEN_TTL_DAYS, ge=1, le=365)


@router.get("/v1/workspaces/{workspace_id}/agent-tokens")
async def list_agent_tokens(
    workspace_id: str,
    auth: Annotated[AuthContext, Depends(require_workspace_access)],
    connection=Depends(get_workspace_conn),
) -> dict:
    if auth.actor_type != "human":
        raise HTTPException(status_code=403, detail="Only human users can manage tokens")
    rows = await connection.fetch(
        """
        SELECT id::text AS id, name, token_prefix, scope, expires_at, last_used_at, created_at
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
    connection=Depends(get_workspace_conn),
) -> dict:
    if auth.actor_type != "human" or not auth.user_id:
        raise HTTPException(status_code=403, detail="Only human users can create agent tokens")
    if body.scope not in VALID_TOKEN_SCOPES:
        raise HTTPException(status_code=400, detail=f"Invalid scope '{body.scope}'. Must be one of: {', '.join(sorted(VALID_TOKEN_SCOPES))}")
    token = await create_workspace_agent_token(workspace_id, auth.user_id, body.name, body.scope, body.expires_in_days)
    await log_activity(
        workspace_id=workspace_id,
        actor_type="human",
        actor_id=auth.user_id,
        event_type="agent_token.created",
        payload={"name": body.name, "scope": body.scope, "token_prefix": token["token_prefix"]},
        connection=connection,
    )
    return {"data": token}


@router.delete("/v1/workspaces/{workspace_id}/agent-tokens/{token_id}")
async def revoke_agent_token(
    workspace_id: str,
    token_id: str,
    auth: Annotated[AuthContext, Depends(require_workspace_access)],
    connection=Depends(get_workspace_conn),
) -> dict:
    if auth.actor_type != "human":
        raise HTTPException(status_code=403, detail="Only human users can revoke agent tokens")
    await connection.execute(
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
        connection=connection,
    )
    return {"data": {"revoked": True}}

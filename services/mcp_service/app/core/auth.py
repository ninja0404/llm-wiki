from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException

from llm_wiki_core.db import get_db_pool
from llm_wiki_core.security import hash_agent_token

VALID_SCOPES = {"read", "write", "admin"}
WRITE_TOOLS = {"create", "replace", "append", "delete"}


@dataclass(slots=True)
class AgentContext:
    token_id: str
    workspace_id: str
    scope: str


async def validate_agent(workspace_id: str, agent_token: str, tool_name: str = "") -> AgentContext:
    pool = await get_db_pool()
    row = await pool.fetchrow(
        """
        SELECT id::text AS id, scope
        FROM agent_tokens
        WHERE workspace_id = $1::uuid
          AND token_hash = $2
          AND revoked_at IS NULL
        """,
        workspace_id,
        hash_agent_token(agent_token),
    )
    if not row:
        raise HTTPException(status_code=401, detail="Invalid agent token")

    scope = row["scope"]
    if scope not in VALID_SCOPES:
        raise HTTPException(status_code=403, detail=f"Token has invalid scope '{scope}'")

    if tool_name in WRITE_TOOLS and scope == "read":
        raise HTTPException(status_code=403, detail=f"Token scope '{scope}' cannot call write tool '{tool_name}'")

    await pool.execute(
        "UPDATE agent_tokens SET last_used_at = NOW() WHERE id = $1::uuid",
        row["id"],
    )

    return AgentContext(token_id=row["id"], workspace_id=workspace_id, scope=scope)

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ...core.deps import AuthContext, require_agent_write_scope, require_workspace_access
from llm_wiki_core.db import get_db_pool


router = APIRouter(tags=["settings"])


class WorkspaceSettingsUpdate(BaseModel):
    llm_provider: str
    llm_model: str
    llm_api_key: str = ""
    llm_base_url: str = ""
    embedding_provider: str
    embedding_model: str
    embedding_api_key: str = ""
    embedding_base_url: str = ""
    compiler_rules: dict = Field(default_factory=dict)
    search_rules: dict = Field(default_factory=dict)


@router.get("/v1/workspaces/{workspace_id}/settings")
async def get_settings(
    workspace_id: str,
    auth: Annotated[AuthContext, Depends(require_workspace_access)],
) -> dict:
    pool = await get_db_pool()
    row = await pool.fetchrow(
        """
        SELECT llm_provider, llm_model, llm_api_key, llm_base_url,
               embedding_provider, embedding_model, embedding_api_key, embedding_base_url,
               compiler_rules, search_rules
        FROM workspace_settings
        WHERE workspace_id = $1::uuid
        """,
        workspace_id,
    )
    data = dict(row)
    if data.get("llm_api_key"):
        data["llm_api_key"] = data["llm_api_key"][:8] + "…"
    if data.get("embedding_api_key"):
        data["embedding_api_key"] = data["embedding_api_key"][:8] + "…"
    return {"data": data}


@router.put("/v1/workspaces/{workspace_id}/settings")
async def update_settings(
    workspace_id: str,
    body: WorkspaceSettingsUpdate,
    auth: Annotated[AuthContext, Depends(require_workspace_access)],
) -> dict:
    require_agent_write_scope(auth)
    pool = await get_db_pool()

    current = await pool.fetchrow(
        "SELECT llm_api_key, embedding_api_key FROM workspace_settings WHERE workspace_id = $1::uuid",
        workspace_id,
    )
    def _is_masked(val: str) -> bool:
        return "…" in val or "..." in val

    llm_api_key = body.llm_api_key if body.llm_api_key and not _is_masked(body.llm_api_key) else (current["llm_api_key"] if current else "")
    embedding_api_key = body.embedding_api_key if body.embedding_api_key and not _is_masked(body.embedding_api_key) else (current["embedding_api_key"] if current else "")

    await pool.execute(
        """
        UPDATE workspace_settings
        SET llm_provider = $2, llm_model = $3, llm_api_key = $4, llm_base_url = $5,
            embedding_provider = $6, embedding_model = $7, embedding_api_key = $8, embedding_base_url = $9,
            compiler_rules = $10::jsonb, search_rules = $11::jsonb
        WHERE workspace_id = $1::uuid
        """,
        workspace_id,
        body.llm_provider,
        body.llm_model,
        llm_api_key,
        body.llm_base_url,
        body.embedding_provider,
        body.embedding_model,
        embedding_api_key,
        body.embedding_base_url,
        body.compiler_rules,
        body.search_rules,
    )
    return {"data": {"updated": True}}

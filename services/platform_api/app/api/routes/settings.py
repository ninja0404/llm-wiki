from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ...core.deps import AuthContext, get_workspace_conn, require_agent_write_scope, require_workspace_access
from llm_wiki_core.crypto import encrypt_value, masked_secret


router = APIRouter(tags=["settings"])


class WorkspaceSettingsView(BaseModel):
    llm_provider: str
    llm_model: str
    llm_base_url: str
    llm_api_key_masked: str | None = None
    llm_api_key_key_version: str | None = None
    embedding_provider: str
    embedding_model: str
    embedding_base_url: str
    embedding_api_key_masked: str | None = None
    embedding_api_key_key_version: str | None = None
    compiler_rules: dict = Field(default_factory=dict)
    search_rules: dict = Field(default_factory=dict)


class WorkspaceSettingsUpdate(BaseModel):
    llm_provider: str
    llm_model: str
    llm_api_key: str | None = None
    llm_base_url: str = ""
    embedding_provider: str
    embedding_model: str
    embedding_api_key: str | None = None
    embedding_base_url: str = ""
    compiler_rules: dict = Field(default_factory=dict)
    search_rules: dict = Field(default_factory=dict)


@router.get("/v1/workspaces/{workspace_id}/settings")
async def get_settings(
    workspace_id: str,
    auth: Annotated[AuthContext, Depends(require_workspace_access)],
    connection=Depends(get_workspace_conn),
) -> dict:
    row = await connection.fetchrow(
        """
        SELECT llm_provider, llm_model, llm_base_url,
               llm_api_key_ciphertext, llm_api_key_key_version,
               embedding_provider, embedding_model, embedding_base_url,
               embedding_api_key_ciphertext, embedding_api_key_key_version,
               compiler_rules, search_rules
        FROM workspace_settings
        WHERE workspace_id = $1::uuid
        """,
        workspace_id,
    )
    data = WorkspaceSettingsView(
        llm_provider=row["llm_provider"],
        llm_model=row["llm_model"],
        llm_base_url=row["llm_base_url"],
        llm_api_key_masked=masked_secret(row["llm_api_key_ciphertext"], row["llm_api_key_key_version"]),
        llm_api_key_key_version=row["llm_api_key_key_version"],
        embedding_provider=row["embedding_provider"],
        embedding_model=row["embedding_model"],
        embedding_base_url=row["embedding_base_url"],
        embedding_api_key_masked=masked_secret(row["embedding_api_key_ciphertext"], row["embedding_api_key_key_version"]),
        embedding_api_key_key_version=row["embedding_api_key_key_version"],
        compiler_rules=row["compiler_rules"] or {},
        search_rules=row["search_rules"] or {},
    ).model_dump()
    return {"data": data}


@router.put("/v1/workspaces/{workspace_id}/settings")
async def update_settings(
    workspace_id: str,
    body: WorkspaceSettingsUpdate,
    auth: Annotated[AuthContext, Depends(require_workspace_access)],
    connection=Depends(get_workspace_conn),
) -> dict:
    require_agent_write_scope(auth)
    current = await connection.fetchrow(
        """
        SELECT llm_api_key_ciphertext, llm_api_key_key_version,
               embedding_api_key_ciphertext, embedding_api_key_key_version
        FROM workspace_settings
        WHERE workspace_id = $1::uuid
        """,
        workspace_id,
    )
    llm_secret = encrypt_value(body.llm_api_key) if body.llm_api_key else None
    embedding_secret = encrypt_value(body.embedding_api_key) if body.embedding_api_key else None

    await connection.execute(
        """
        UPDATE workspace_settings
        SET llm_provider = $2,
            llm_model = $3,
            llm_api_key_ciphertext = $4,
            llm_api_key_key_version = $5,
            llm_base_url = $6,
            embedding_provider = $7,
            embedding_model = $8,
            embedding_api_key_ciphertext = $9,
            embedding_api_key_key_version = $10,
            embedding_base_url = $11,
            compiler_rules = $12::jsonb,
            search_rules = $13::jsonb
        WHERE workspace_id = $1::uuid
        """,
        workspace_id,
        body.llm_provider,
        body.llm_model,
        llm_secret.ciphertext if llm_secret else current["llm_api_key_ciphertext"],
        llm_secret.key_version if llm_secret else current["llm_api_key_key_version"],
        body.llm_base_url,
        body.embedding_provider,
        body.embedding_model,
        embedding_secret.ciphertext if embedding_secret else current["embedding_api_key_ciphertext"],
        embedding_secret.key_version if embedding_secret else current["embedding_api_key_key_version"],
        body.embedding_base_url,
        body.compiler_rules,
        body.search_rules,
    )
    return {"data": {"updated": True}}

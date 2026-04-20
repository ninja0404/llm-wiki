from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from ...core.deps import AuthContext, get_workspace_conn, require_workspace_access
from ...core.rate_limit import limiter
from llm_wiki_core.search_service import hybrid_search_workspace


router = APIRouter(tags=["search"])


@router.get("/v1/workspaces/{workspace_id}/search")
@limiter.limit("30/minute")
async def search_workspace(
    request: Request,
    workspace_id: str,
    auth: Annotated[AuthContext, Depends(require_workspace_access)],
    connection=Depends(get_workspace_conn),
    q: str = Query(min_length=1),
    limit: int = Query(default=0, ge=0, le=50),
) -> dict:
    result = await hybrid_search_workspace(connection, workspace_id, q.strip(), limit)
    return {"data": result.items, "backend": result.backend, "search_rules": result.search_rules}

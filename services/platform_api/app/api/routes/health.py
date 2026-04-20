from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from ...core.deps import AuthContext, require_platform_admin
from llm_wiki_core.db import get_db_pool
from llm_wiki_core.queue import (
    delete_dlq_message,
    get_queue_depths,
    get_redis,
    list_dlq,
    replay_dlq_message,
)


router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    pool = await get_db_pool()
    redis = await get_redis()
    await pool.fetchval("SELECT 1")
    await redis.ping()
    depths = await get_queue_depths()
    return {"status": "ok", "queue": depths}


@router.get("/v1/admin/dlq")
async def admin_list_dlq(auth: Annotated[AuthContext, Depends(require_platform_admin)]) -> dict:
    messages = await list_dlq(count=100)
    return {"data": messages}


@router.post("/v1/admin/dlq/{message_id}/replay")
async def admin_replay_dlq(message_id: str, auth: Annotated[AuthContext, Depends(require_platform_admin)]) -> dict:
    replayed = await replay_dlq_message(message_id)
    if not replayed:
        raise HTTPException(status_code=404, detail="DLQ message not found")
    return {"data": {"replayed": True}}


@router.delete("/v1/admin/dlq/{message_id}")
async def admin_delete_dlq(message_id: str, auth: Annotated[AuthContext, Depends(require_platform_admin)]) -> dict:
    deleted = await delete_dlq_message(message_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="DLQ message not found")
    return {"data": {"deleted": True}}

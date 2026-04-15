from fastapi import APIRouter

from llm_wiki_core.db import get_db_pool
from llm_wiki_core.queue import get_redis


router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    pool = await get_db_pool()
    redis = await get_redis()
    await pool.fetchval("SELECT 1")
    await redis.ping()
    return {"status": "ok"}

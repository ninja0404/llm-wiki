from __future__ import annotations

import json
from typing import Any

from redis.asyncio import Redis

from .config import get_settings


_redis: Redis | None = None


async def get_redis() -> Redis:
    global _redis
    if _redis is None:
        settings = get_settings()
        _redis = Redis.from_url(settings.redis_url, encoding="utf-8", decode_responses=True)
    return _redis


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        try:
            await _redis.aclose()
        except Exception:
            pass
        _redis = None


async def enqueue_run(run_id: str) -> None:
    redis = await get_redis()
    await redis.rpush("llm-wiki:runs", run_id)


async def pop_run(timeout_seconds: int = 5) -> str | None:
    redis = await get_redis()
    item = await redis.blpop("llm-wiki:runs", timeout=timeout_seconds)
    if not item:
        return None
    _, run_id = item
    return run_id


async def publish_event(channel: str, payload: dict[str, Any]) -> None:
    redis = await get_redis()
    await redis.publish(channel, json.dumps(payload))

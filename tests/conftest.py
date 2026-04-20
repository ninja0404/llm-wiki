from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
import pytest

from llm_wiki_core.config import get_settings
from llm_wiki_core.queue import (
    DLQ_KEY,
    IDEMPOTENCY_PREFIX,
    RUN_ATTEMPT_PREFIX,
    RUN_LOCK_PREFIX,
    STREAM_KEY,
    close_redis,
    get_redis,
)


@pytest.fixture(scope="session", autouse=True)
def _apply_test_migrations() -> None:
    config = Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))
    config.set_main_option("script_location", str(Path(__file__).resolve().parent.parent / "alembic"))
    database_url = get_settings().database_url
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    config.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(config, "head")


@pytest.fixture(autouse=True)
async def _reset_db_pool():
    """Reset the asyncpg pool between tests to avoid event-loop mismatch."""
    yield
    from llm_wiki_core.db import close_db_pool
    await close_db_pool()


async def _reset_queue_state() -> None:
    """Keep Redis queue state isolated between tests."""
    await close_redis()
    redis = await get_redis()
    await redis.delete(STREAM_KEY, DLQ_KEY)
    for prefix in (IDEMPOTENCY_PREFIX, RUN_LOCK_PREFIX, RUN_ATTEMPT_PREFIX):
        keys = await redis.keys(f"{prefix}*")
        if keys:
            await redis.delete(*keys)


@pytest.fixture(autouse=True)
async def _reset_queue():
    await _reset_queue_state()
    yield
    await _reset_queue_state()

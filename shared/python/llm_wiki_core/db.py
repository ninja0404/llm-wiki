from contextlib import asynccontextmanager

import asyncpg
import orjson

from .config import get_settings


_pool: asyncpg.Pool | None = None


async def _init_connection(connection: asyncpg.Connection) -> None:
    await connection.set_type_codec(
        "json",
        encoder=lambda value: orjson.dumps(value).decode(),
        decoder=orjson.loads,
        schema="pg_catalog",
    )
    await connection.set_type_codec(
        "jsonb",
        encoder=lambda value: orjson.dumps(value).decode(),
        decoder=orjson.loads,
        schema="pg_catalog",
        format="text",
    )


async def init_db_pool() -> asyncpg.Pool:
    global _pool
    needs_create = _pool is None
    if not needs_create:
        try:
            needs_create = _pool._closed or _pool._closing
        except AttributeError:
            needs_create = True
    if needs_create:
        settings = get_settings()
        _pool = await asyncpg.create_pool(
            settings.database_url,
            min_size=2,
            max_size=10,
            command_timeout=60,
            init=_init_connection,
        )
    return _pool


async def get_db_pool() -> asyncpg.Pool:
    return await init_db_pool()


async def close_db_pool() -> None:
    global _pool
    if _pool is not None:
        try:
            _pool.terminate()
        except Exception:
            pass
        _pool = None


@asynccontextmanager
async def acquire() -> asyncpg.Connection:
    pool = await get_db_pool()
    async with pool.acquire() as connection:
        yield connection

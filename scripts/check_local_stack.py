from __future__ import annotations

import asyncio
import os
from pathlib import Path
import sys

import asyncpg
from minio import Minio
from redis.asyncio import Redis

ROOT = Path(__file__).resolve().parent.parent
SHARED_PYTHON = ROOT / "shared/python"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(SHARED_PYTHON) not in sys.path:
    sys.path.insert(0, str(SHARED_PYTHON))

from llm_wiki_core.config import get_settings


async def check_postgres(settings) -> str | None:
    try:
        connection = await asyncpg.connect(settings.database_url, command_timeout=5)
    except Exception as exc:  # noqa: BLE001
        return f"Postgres unavailable: {exc}"
    try:
        await connection.fetchval("SELECT 1")
        return None
    finally:
        await connection.close()


async def check_redis(settings) -> str | None:
    redis = Redis.from_url(settings.redis_url, encoding="utf-8", decode_responses=True)
    try:
        await redis.ping()
        return None
    except Exception as exc:  # noqa: BLE001
        return f"Redis unavailable: {exc}"
    finally:
        await redis.aclose()


def check_minio(settings) -> str | None:
    try:
        client = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_use_ssl,
        )
        client.bucket_exists(settings.minio_bucket)
        return None
    except Exception as exc:  # noqa: BLE001
        return f"MinIO unavailable: {exc}"


async def main() -> int:
    settings = get_settings()
    errors = [
        await check_postgres(settings),
        await check_redis(settings),
        check_minio(settings),
    ]
    failures = [error for error in errors if error]
    if failures:
        for failure in failures:
            print(failure, file=sys.stderr)
        return 1
    print("Local dependencies are ready: Postgres, Redis, MinIO")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

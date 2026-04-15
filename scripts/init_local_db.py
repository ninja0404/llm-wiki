from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import asyncpg
from minio import Minio


ROOT = Path(__file__).resolve().parent.parent
SHARED_PYTHON = ROOT / "shared/python"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(SHARED_PYTHON) not in sys.path:
    sys.path.insert(0, str(SHARED_PYTHON))

from llm_wiki_core.config import get_settings


MIGRATION_PATH = ROOT / "db/migrations/001_vnext_schema.sql"


async def main() -> int:
    settings = get_settings()
    sql = MIGRATION_PATH.read_text(encoding="utf-8")
    connection = await asyncpg.connect(settings.database_url, command_timeout=120)
    try:
        reset_requested = "--reset" in sys.argv[1:]
        if reset_requested:
            await connection.execute("DROP SCHEMA public CASCADE;")
            await connection.execute("CREATE SCHEMA public;")
            await connection.execute("GRANT ALL ON SCHEMA public TO public;")
        await connection.execute(sql)
    finally:
        await connection.close()

    client = Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_use_ssl,
    )
    if not client.bucket_exists(settings.minio_bucket):
        client.make_bucket(settings.minio_bucket)

    print(f"Initialized local database schema from {MIGRATION_PATH}")
    print(f"Ensured MinIO bucket `{settings.minio_bucket}` exists")
    if reset_requested:
        print("Reset existing public schema before initialization")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import asyncpg
from alembic import command
from alembic.config import Config
from minio import Minio


ROOT = Path(__file__).resolve().parent.parent
SHARED_PYTHON = ROOT / "shared/python"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(SHARED_PYTHON) not in sys.path:
    sys.path.insert(0, str(SHARED_PYTHON))

from llm_wiki_core.config import get_settings  # noqa: E402


async def main() -> int:
    settings = get_settings()
    connection = await asyncpg.connect(settings.database_url, command_timeout=120)
    try:
        reset_requested = "--reset" in sys.argv[1:]
        if reset_requested:
            await connection.execute("DROP SCHEMA public CASCADE;")
            await connection.execute("CREATE SCHEMA public;")
            await connection.execute("GRANT ALL ON SCHEMA public TO public;")
    finally:
        await connection.close()

    alembic_cfg = Config(str(ROOT / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(ROOT / "alembic"))
    db_url = settings.database_url
    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)
    alembic_cfg.set_main_option("sqlalchemy.url", db_url)
    command.upgrade(alembic_cfg, "head")
    print("Applied alembic upgrade head")

    try:
        client = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_use_ssl,
        )
        if not client.bucket_exists(settings.minio_bucket):
            client.make_bucket(settings.minio_bucket)
        print(f"Ensured MinIO bucket `{settings.minio_bucket}` exists")
    except Exception as exc:
        print(f"Warning: MinIO not available ({exc}), skipping bucket check")

    print("Initialized local database via Alembic")
    if reset_requested:
        print("Reset existing public schema before initialization")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

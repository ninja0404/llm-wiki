from __future__ import annotations

import asyncio
import logging

from llm_wiki_core.config import get_settings
from llm_wiki_core.db import close_db_pool, init_db_pool
from llm_wiki_core.queue import close_redis, pop_run

from .pipeline.runner import fail_run, process_run


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main() -> None:
    settings = get_settings()
    await init_db_pool()
    logger.info("compiler worker started")
    try:
        while True:
            run_id = await pop_run(timeout_seconds=5)
            if not run_id:
                await asyncio.sleep(settings.worker_poll_interval_ms / 1000)
                continue
            try:
                logger.info("processing run %s", run_id)
                await process_run(run_id)
            except Exception as exc:  # noqa: BLE001
                logger.exception("run processing failed: %s", run_id)
                await fail_run(run_id, None, str(exc))
    finally:
        await close_db_pool()
        await close_redis()


if __name__ == "__main__":
    asyncio.run(main())

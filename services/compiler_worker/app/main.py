from __future__ import annotations

import asyncio
import os

import structlog

from llm_wiki_core.config import get_settings
from llm_wiki_core.db import close_db_pool, init_db_pool
from llm_wiki_core.logging import configure_logging
from llm_wiki_core.metrics import ACTIVE_RUNS, RUN_DURATION, RUN_LOCK_CONFLICTS_TOTAL, RUN_TOTAL
from llm_wiki_core.queue import (
    acquire_run_lock,
    ack_run,
    close_redis,
    MAX_RETRIES,
    nack_to_dlq,
    pop_run,
    reclaim_pending,
    refresh_run_lock,
    release_run_lock,
    retry_run,
)
from llm_wiki_core.tracing import configure_tracing, extract_trace_context, get_tracer

from .pipeline.runner import fail_run, process_run, schedule_retry


configure_logging(json_output=True)
configure_tracing(service_name="compiler-worker")
logger = structlog.get_logger()
tracer = get_tracer("compiler-worker")

CONSUMER_NAME = f"worker-{os.getpid()}"


async def main() -> None:
    settings = get_settings()
    await init_db_pool()
    logger.info("compiler worker started (consumer=%s)", CONSUMER_NAME)
    try:
        while True:
            reclaimed = await reclaim_pending(CONSUMER_NAME)
            for msg_id, run_id, workspace_id, trace_carrier, attempts in reclaimed:
                await _handle(msg_id, run_id, workspace_id, trace_carrier, attempts)

            msg_id, run_id, workspace_id, trace_carrier, attempts = await pop_run(CONSUMER_NAME, timeout_ms=5000)
            if not msg_id or not run_id or not workspace_id:
                await asyncio.sleep(settings.worker_poll_interval_ms / 1000)
                continue
            await _handle(msg_id, run_id, workspace_id, trace_carrier, attempts)
    finally:
        await close_db_pool()
        await close_redis()


async def _renew_run_lock(run_id: str, token: str, interval_seconds: float) -> None:
    try:
        while True:
            await asyncio.sleep(interval_seconds)
            refreshed = await refresh_run_lock(run_id, token)
            if not refreshed:
                logger.warning("run lock refresh failed for %s", run_id)
                return
    except asyncio.CancelledError:
        raise


async def _handle(msg_id: str, run_id: str, workspace_id: str, trace_carrier: dict[str, str], attempts: int) -> None:
    import time

    ACTIVE_RUNS.inc()
    start = time.perf_counter()
    lock_token = await acquire_run_lock(run_id)
    if not lock_token:
        logger.warning("run %s is already locked; leaving message pending for later reclaim", run_id)
        RUN_LOCK_CONFLICTS_TOTAL.inc()
        ACTIVE_RUNS.dec()
        return
    renew_task = asyncio.create_task(_renew_run_lock(run_id, lock_token, 30.0))
    try:
        with tracer.start_as_current_span(
            "process_run",
            context=extract_trace_context(trace_carrier),
            attributes={"run.id": run_id, "msg.id": msg_id, "workspace.id": workspace_id, "run.attempt": attempts},
        ):
            logger.info("processing run %s (msg=%s workspace=%s attempt=%s)", run_id, msg_id, workspace_id, attempts)
            await process_run(run_id, workspace_id, attempts=attempts)
            await ack_run(msg_id)
        RUN_TOTAL.labels(status="succeeded").inc()
        RUN_DURATION.labels(status="succeeded").observe(time.perf_counter() - start)
    except Exception as exc:  # noqa: BLE001
        logger.exception("run processing failed: %s", run_id)
        if attempts < MAX_RETRIES:
            next_attempt = attempts + 1
            await schedule_retry(run_id, workspace_id, str(exc), next_attempt)
            await retry_run(msg_id, run_id, workspace_id, trace_carrier)
            RUN_TOTAL.labels(status="retried").inc()
            RUN_DURATION.labels(status="retried").observe(time.perf_counter() - start)
        else:
            await fail_run(run_id, workspace_id, str(exc))
            await nack_to_dlq(msg_id, run_id, workspace_id, str(exc), attempts)
            RUN_TOTAL.labels(status="failed").inc()
            RUN_DURATION.labels(status="failed").observe(time.perf_counter() - start)
    finally:
        renew_task.cancel()
        try:
            await renew_task
        except asyncio.CancelledError:
            pass
        await release_run_lock(run_id, lock_token)
        ACTIVE_RUNS.dec()


if __name__ == "__main__":
    asyncio.run(main())

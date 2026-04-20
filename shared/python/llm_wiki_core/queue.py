from __future__ import annotations

import asyncio
import json
import logging
import secrets
from typing import Any

from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from redis.asyncio import Redis
from redis.exceptions import ResponseError

from .config import get_settings
from .metrics import QUEUE_DEPTH, QUEUE_DLQ_DEPTH, QUEUE_DLQ_TOTAL, QUEUE_RECLAIMS_TOTAL, QUEUE_REPLAYS_TOTAL, QUEUE_RETRIES_TOTAL
from .tracing import inject_trace_headers

logger = logging.getLogger(__name__)

_redis: Redis | None = None
_redis_loop: asyncio.AbstractEventLoop | None = None

STREAM_KEY = "llm-wiki:runs:stream"
GROUP_NAME = "compiler-workers"
DLQ_KEY = "llm-wiki:runs:dlq"
IDEMPOTENCY_PREFIX = "llm-wiki:idem:"
RUN_LOCK_PREFIX = "llm-wiki:run-lock:"
RUN_ATTEMPT_PREFIX = "llm-wiki:run-attempt:"
IDEMPOTENCY_TTL_SECONDS = 3600
RUN_LOCK_TTL_SECONDS = 900
RUN_ATTEMPT_TTL_SECONDS = 86400
MAX_RETRIES = 3
_TRACE_PROPAGATOR = TraceContextTextMapPropagator()


async def get_redis() -> Redis:
    global _redis, _redis_loop
    current_loop = asyncio.get_running_loop()
    if _redis is not None and _redis_loop is not current_loop:
        try:
            await _redis.aclose()
        except Exception:
            pass
        _redis = None
        _redis_loop = None
    if _redis is None:
        settings = get_settings()
        _redis = Redis.from_url(settings.redis_url, encoding="utf-8", decode_responses=True)
        _redis_loop = current_loop
    return _redis


async def close_redis() -> None:
    global _redis, _redis_loop
    if _redis is not None:
        try:
            await _redis.aclose()
        except Exception:
            pass
        _redis = None
        _redis_loop = None


async def _ensure_group() -> None:
    redis = await get_redis()
    try:
        await redis.xgroup_create(STREAM_KEY, GROUP_NAME, id="0", mkstream=True)
    except ResponseError as exc:
        if "BUSYGROUP" not in str(exc):
            raise


async def _update_queue_metrics(redis: Redis | None = None) -> None:
    client = redis or await get_redis()
    QUEUE_DEPTH.set(await client.xlen(STREAM_KEY))
    QUEUE_DLQ_DEPTH.set(await client.xlen(DLQ_KEY))


def _run_attempt_key(run_id: str) -> str:
    return f"{RUN_ATTEMPT_PREFIX}{run_id}"


async def _set_run_attempt(run_id: str, attempts: int, redis: Redis | None = None) -> None:
    client = redis or await get_redis()
    await client.set(_run_attempt_key(run_id), str(attempts), ex=RUN_ATTEMPT_TTL_SECONDS)


async def _get_run_attempt(run_id: str, redis: Redis | None = None) -> int:
    client = redis or await get_redis()
    current = await client.get(_run_attempt_key(run_id))
    return int(current or "0")


async def _incr_run_attempt(run_id: str, redis: Redis | None = None) -> int:
    client = redis or await get_redis()
    value = await client.incr(_run_attempt_key(run_id))
    await client.expire(_run_attempt_key(run_id), RUN_ATTEMPT_TTL_SECONDS)
    return int(value)


async def enqueue_run(run_id: str, workspace_id: str, idempotency_key: str | None = None) -> bool:
    """Enqueue a run. Returns False if a duplicate idempotency_key is detected."""
    await _ensure_group()
    redis = await get_redis()
    if idempotency_key:
        idem_key = f"{IDEMPOTENCY_PREFIX}{idempotency_key}"
        was_set = await redis.set(idem_key, run_id, nx=True, ex=IDEMPOTENCY_TTL_SECONDS)
        if not was_set:
            logger.info("duplicate enqueue blocked: key=%s run_id=%s", idempotency_key, run_id)
            return False
    carrier = inject_trace_headers({})
    fields = {
        "run_id": run_id,
        "workspace_id": workspace_id,
        "traceparent": carrier.get("traceparent", ""),
        "tracestate": carrier.get("tracestate", ""),
    }
    await redis.xadd(STREAM_KEY, fields)
    await _set_run_attempt(run_id, 0, redis)
    await _update_queue_metrics(redis)
    return True


async def pop_run(consumer_name: str, timeout_ms: int = 5000) -> tuple[str | None, str | None, str | None, dict[str, str], int]:
    """Return (message_id, run_id, workspace_id, trace_carrier, attempts) or empty values."""
    await _ensure_group()
    redis = await get_redis()
    try:
        results = await redis.xreadgroup(
            GROUP_NAME,
            consumer_name,
            {STREAM_KEY: ">"},
            count=1,
            block=timeout_ms,
        )
    except ResponseError as exc:
        if "NOGROUP" not in str(exc):
            raise
        await _ensure_group()
        results = await redis.xreadgroup(
            GROUP_NAME,
            consumer_name,
            {STREAM_KEY: ">"},
            count=1,
            block=timeout_ms,
        )
    if not results:
        return None, None, None, {}, 0
    _stream, messages = results[0]
    if not messages:
        return None, None, None, {}, 0
    message_id, fields = messages[0]
    run_id = fields.get("run_id")
    attempts = 0
    if run_id:
        current_attempt = await _get_run_attempt(run_id, redis)
        if current_attempt < 1:
            await _set_run_attempt(run_id, 1, redis)
            current_attempt = 1
        attempts = current_attempt
    carrier = {
        key: value
        for key, value in {"traceparent": fields.get("traceparent"), "tracestate": fields.get("tracestate")}.items()
        if value
    }
    return message_id, run_id, fields.get("workspace_id"), carrier, attempts


async def ack_run(message_id: str) -> None:
    redis = await get_redis()
    await redis.xack(STREAM_KEY, GROUP_NAME, message_id)
    await _update_queue_metrics(redis)


async def nack_to_dlq(message_id: str, run_id: str, workspace_id: str, error: str, attempts: int) -> None:
    redis = await get_redis()
    await redis.xadd(
        DLQ_KEY,
        {
            "run_id": run_id,
            "workspace_id": workspace_id,
            "attempts": str(attempts),
            "error": error[:500],
            "source_msg_id": message_id,
        },
    )
    await redis.xack(STREAM_KEY, GROUP_NAME, message_id)
    QUEUE_DLQ_TOTAL.inc()
    await _update_queue_metrics(redis)
    logger.warning("run %s moved to DLQ after failure: %s", run_id, error[:200])


async def reclaim_pending(consumer_name: str, idle_ms: int = 60_000) -> list[tuple[str, str, str, dict[str, str], int]]:
    """Reclaim messages idle longer than idle_ms from other consumers."""
    redis = await get_redis()
    try:
        pending = await redis.xpending_range(STREAM_KEY, GROUP_NAME, "-", "+", count=10)
    except ResponseError as exc:
        if "NOGROUP" not in str(exc):
            raise
        await _ensure_group()
        pending = await redis.xpending_range(STREAM_KEY, GROUP_NAME, "-", "+", count=10)
    reclaimed: list[tuple[str, str, str, dict[str, str], int]] = []
    for entry in pending:
        if entry["time_since_delivered"] >= idle_ms:
            original = await redis.xrange(STREAM_KEY, min=entry["message_id"], max=entry["message_id"], count=1)
            if not original:
                continue
            _, original_fields = original[0]
            run_id = original_fields.get("run_id", "")
            workspace_id = original_fields.get("workspace_id", "")
            if not run_id or not workspace_id:
                continue
            if await get_run_lock_owner(run_id, redis):
                continue
            claimed = await redis.xclaim(
                STREAM_KEY, GROUP_NAME, consumer_name, min_idle_time=idle_ms, message_ids=[entry["message_id"]],
            )
            for msg_id, fields in claimed:
                attempts = await _incr_run_attempt(run_id, redis)
                if attempts >= MAX_RETRIES:
                    await nack_to_dlq(
                        msg_id,
                        run_id,
                        workspace_id,
                        "exceeded max retries",
                        attempts,
                    )
                else:
                    QUEUE_RECLAIMS_TOTAL.inc()
                    carrier = {
                        key: value
                        for key, value in {
                            "traceparent": fields.get("traceparent"),
                            "tracestate": fields.get("tracestate"),
                        }.items()
                        if value
                    }
                    reclaimed.append((msg_id, run_id, workspace_id, carrier, attempts))
    return reclaimed


async def list_dlq(count: int = 50) -> list[dict[str, Any]]:
    redis = await get_redis()
    messages = await redis.xrange(DLQ_KEY, count=count)
    return [
        {"message_id": msg_id, **fields}
        for msg_id, fields in messages
    ]


async def replay_dlq_message(message_id: str) -> bool:
    """Move a DLQ message back to the main stream. Returns True if replayed."""
    redis = await get_redis()
    messages = await redis.xrange(DLQ_KEY, min=message_id, max=message_id, count=1)
    if not messages:
        return False
    _, fields = messages[0]
    run_id = fields.get("run_id")
    workspace_id = fields.get("workspace_id")
    if run_id and workspace_id:
        await redis.xadd(STREAM_KEY, {"run_id": run_id, "workspace_id": workspace_id})
        await _set_run_attempt(run_id, 0, redis)
        QUEUE_REPLAYS_TOTAL.inc()
    await redis.xdel(DLQ_KEY, message_id)
    await _update_queue_metrics(redis)
    logger.info("replayed DLQ message %s (run_id=%s)", message_id, run_id)
    return True


async def retry_run(message_id: str, run_id: str, workspace_id: str, trace_carrier: dict[str, str] | None = None) -> int:
    """Ack the failed message and enqueue a retry attempt. Returns the next attempt number."""
    redis = await get_redis()
    next_attempt = await _incr_run_attempt(run_id, redis)
    await redis.xadd(
        STREAM_KEY,
        {
            "run_id": run_id,
            "workspace_id": workspace_id,
            "traceparent": (trace_carrier or {}).get("traceparent", ""),
            "tracestate": (trace_carrier or {}).get("tracestate", ""),
        },
    )
    await redis.xack(STREAM_KEY, GROUP_NAME, message_id)
    QUEUE_RETRIES_TOTAL.inc()
    await _update_queue_metrics(redis)
    logger.info("scheduled retry for run %s (attempt=%s)", run_id, next_attempt)
    return next_attempt


async def delete_dlq_message(message_id: str) -> bool:
    redis = await get_redis()
    deleted = await redis.xdel(DLQ_KEY, message_id)
    await _update_queue_metrics(redis)
    return deleted > 0


async def get_queue_depths() -> dict[str, int]:
    redis = await get_redis()
    stream_len = await redis.xlen(STREAM_KEY)
    dlq_len = await redis.xlen(DLQ_KEY)
    QUEUE_DEPTH.set(stream_len)
    QUEUE_DLQ_DEPTH.set(dlq_len)
    return {"stream": stream_len, "dlq": dlq_len}


async def publish_event(channel: str, payload: dict[str, Any]) -> None:
    redis = await get_redis()
    await redis.publish(channel, json.dumps(payload))


async def acquire_run_lock(run_id: str, ttl_seconds: int = RUN_LOCK_TTL_SECONDS) -> str | None:
    redis = await get_redis()
    token = secrets.token_urlsafe(18)
    if await redis.set(f"{RUN_LOCK_PREFIX}{run_id}", token, nx=True, ex=ttl_seconds):
        return token
    return None


async def refresh_run_lock(run_id: str, token: str, ttl_seconds: int = RUN_LOCK_TTL_SECONDS) -> bool:
    redis = await get_redis()
    script = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end
return 0
"""
    return bool(await redis.eval(script, 1, f"{RUN_LOCK_PREFIX}{run_id}", token, str(ttl_seconds)))


async def release_run_lock(run_id: str, token: str) -> None:
    redis = await get_redis()
    script = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""
    await redis.eval(script, 1, f"{RUN_LOCK_PREFIX}{run_id}", token)


async def get_run_lock_owner(run_id: str, redis: Redis | None = None) -> str | None:
    client = redis or await get_redis()
    return await client.get(f"{RUN_LOCK_PREFIX}{run_id}")

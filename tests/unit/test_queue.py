"""Unit tests for Redis Streams queue: idempotency, DLQ, ACK semantics.

These tests use the real queue module but require a Redis connection.
Skipped automatically if Redis is unavailable.
"""

from __future__ import annotations

import pytest

import llm_wiki_core.queue as q


@pytest.fixture(autouse=True)
async def _clean_streams():
    """Flush test streams before and after each test."""
    try:
        await q.close_redis()
        redis = await q.get_redis()
        await redis.delete(q.STREAM_KEY, q.DLQ_KEY)
        for key in await redis.keys(f"{q.IDEMPOTENCY_PREFIX}*"):
            await redis.delete(key)
        for key in await redis.keys(f"{q.RUN_LOCK_PREFIX}*"):
            await redis.delete(key)
        for key in await redis.keys(f"{q.RUN_ATTEMPT_PREFIX}*"):
            await redis.delete(key)
    except Exception:
        pytest.skip("Redis not available")
    yield
    try:
        redis = await q.get_redis()
        await redis.delete(q.STREAM_KEY, q.DLQ_KEY)
        for key in await redis.keys(f"{q.IDEMPOTENCY_PREFIX}*"):
            await redis.delete(key)
        for key in await redis.keys(f"{q.RUN_LOCK_PREFIX}*"):
            await redis.delete(key)
        for key in await redis.keys(f"{q.RUN_ATTEMPT_PREFIX}*"):
            await redis.delete(key)
        await q.close_redis()
    except Exception:
        pass


async def test_enqueue_and_pop():
    ok = await q.enqueue_run("run-001", "ws-001")
    assert ok is True
    msg_id, run_id, workspace_id, _carrier, attempts = await q.pop_run("test-worker", timeout_ms=2000)
    assert run_id == "run-001"
    assert workspace_id == "ws-001"
    assert attempts == 1
    assert msg_id is not None


async def test_ack_removes_from_pending():
    await q.enqueue_run("run-002", "ws-002")
    msg_id, _, _, _, _ = await q.pop_run("test-worker", timeout_ms=2000)
    await q.ack_run(msg_id)
    redis = await q.get_redis()
    pending = await redis.xpending(q.STREAM_KEY, q.GROUP_NAME)
    assert pending["pending"] == 0


async def test_idempotency_blocks_duplicate():
    ok1 = await q.enqueue_run("run-A", "ws1", idempotency_key="ws1:doc1")
    ok2 = await q.enqueue_run("run-B", "ws1", idempotency_key="ws1:doc1")
    assert ok1 is True
    assert ok2 is False
    depths = await q.get_queue_depths()
    assert depths["stream"] == 1


async def test_idempotency_allows_different_keys():
    ok1 = await q.enqueue_run("run-X", "ws1", idempotency_key="ws1:docA")
    ok2 = await q.enqueue_run("run-Y", "ws1", idempotency_key="ws1:docB")
    assert ok1 is True
    assert ok2 is True
    depths = await q.get_queue_depths()
    assert depths["stream"] == 2


async def test_nack_to_dlq():
    await q.enqueue_run("run-fail", "ws-fail")
    msg_id, run_id, workspace_id, _carrier, _attempts = await q.pop_run("test-worker", timeout_ms=2000)
    await q.nack_to_dlq(msg_id, run_id, workspace_id, "some error", attempts=1)
    depths = await q.get_queue_depths()
    assert depths["dlq"] == 1


async def test_list_dlq():
    await q.enqueue_run("run-dead", "ws-dead")
    msg_id, run_id, workspace_id, _carrier, _attempts = await q.pop_run("test-worker", timeout_ms=2000)
    await q.nack_to_dlq(msg_id, run_id, workspace_id, "crash", attempts=1)
    messages = await q.list_dlq()
    assert len(messages) == 1
    assert messages[0]["run_id"] == "run-dead"
    assert messages[0]["workspace_id"] == "ws-dead"
    assert "crash" in messages[0]["error"]


async def test_replay_dlq():
    await q.enqueue_run("run-replay", "ws-replay")
    msg_id, run_id, workspace_id, _carrier, _attempts = await q.pop_run("test-worker", timeout_ms=2000)
    await q.nack_to_dlq(msg_id, run_id, workspace_id, "transient error", attempts=1)
    dlq = await q.list_dlq()
    replayed = await q.replay_dlq_message(dlq[0]["message_id"])
    assert replayed is True
    assert (await q.get_queue_depths())["dlq"] == 0
    msg_id2, run_id2, workspace_id2, _carrier2, attempts2 = await q.pop_run("test-worker", timeout_ms=2000)
    assert run_id2 == "run-replay"
    assert workspace_id2 == "ws-replay"
    assert attempts2 == 1
    await q.ack_run(msg_id2)


async def test_reclaim_pending_increments_attempts():
    await q.enqueue_run("run-reclaim", "ws-reclaim")
    msg_id, run_id, workspace_id, _, attempts = await q.pop_run("test-worker", timeout_ms=2000)
    assert run_id == "run-reclaim"
    assert workspace_id == "ws-reclaim"
    assert attempts == 1
    reclaimed = await q.reclaim_pending("other-worker", idle_ms=0)
    assert len(reclaimed) == 1
    reclaimed_msg_id, reclaimed_run_id, reclaimed_workspace_id, _carrier, attempts = reclaimed[0]
    assert reclaimed_msg_id == msg_id
    assert reclaimed_run_id == run_id
    assert reclaimed_workspace_id == workspace_id
    assert attempts == 2


async def test_reclaim_pending_skips_locked_run():
    await q.enqueue_run("run-locked", "ws-locked")
    msg_id, run_id, workspace_id, _, _attempts = await q.pop_run("test-worker", timeout_ms=2000)
    token = await q.acquire_run_lock(run_id)
    assert token is not None
    reclaimed = await q.reclaim_pending("other-worker", idle_ms=0)
    assert reclaimed == []
    await q.release_run_lock(run_id, token)
    await q.nack_to_dlq(msg_id, run_id, workspace_id, "done", attempts=1)


async def test_run_lock_refresh_extends_lock():
    await q.close_redis()
    token = await q.acquire_run_lock("run-refresh", ttl_seconds=1)
    assert token is not None
    refreshed = await q.refresh_run_lock("run-refresh", token, ttl_seconds=10)
    assert refreshed is True
    owner = await q.get_run_lock_owner("run-refresh")
    assert owner == token
    await q.release_run_lock("run-refresh", token)
    assert await q.get_run_lock_owner("run-refresh") is None


async def test_delete_dlq():
    await q.enqueue_run("run-del", "ws-del")
    msg_id, run_id, workspace_id, _carrier, _attempts = await q.pop_run("test-worker", timeout_ms=2000)
    await q.nack_to_dlq(msg_id, run_id, workspace_id, "fatal", attempts=1)
    dlq = await q.list_dlq()
    deleted = await q.delete_dlq_message(dlq[0]["message_id"])
    assert deleted is True
    assert (await q.get_queue_depths())["dlq"] == 0


async def test_pop_returns_none_when_empty():
    msg_id, run_id, workspace_id, carrier, attempts = await q.pop_run("test-worker", timeout_ms=500)
    assert msg_id is None
    assert run_id is None
    assert workspace_id is None
    assert carrier == {}
    assert attempts == 0

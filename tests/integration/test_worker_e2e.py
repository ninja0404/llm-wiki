from __future__ import annotations

from collections.abc import Generator
import uuid

import pytest
from fastapi import Response
from httpx import ASGITransport, AsyncClient

from llm_wiki_core.queue import get_queue_depths, list_dlq, pop_run
from services.compiler_worker.app import main as worker_main
from services.platform_api.app.core.deps import issue_session, register_user
from services.platform_api.app.services.workspace import bootstrap_workspace
from services.platform_api.app.main import app
from llm_wiki_core.db import get_db_pool


@pytest.fixture(autouse=True)
def _worker_test_patches(monkeypatch) -> Generator[dict[str, bytes], None, None]:
    storage: dict[str, bytes] = {}

    def fake_put_bytes(key: str, data: bytes, content_type: str) -> None:
        storage[key] = data

    def fake_get_bytes(key: str) -> bytes:
        return storage[key]

    async def fake_generate_embedding(text: str, config) -> list[float]:
        return [1.0] + [0.0] * 1023

    async def fake_extract(parsed, blocks, llm_config, compiler_rules):
        return (
            [{"slug": "widget", "title": "Widget", "entity_type": "concept", "summary": "Widget summary"}],
            [{"entity_title": "Widget", "text": "Widget is important.", "confidence": 0.95, "quote": "Widget is important."}],
            [],
        )

    monkeypatch.setattr("services.platform_api.app.api.routes.documents.put_bytes", fake_put_bytes)
    monkeypatch.setattr("services.compiler_worker.app.pipeline.runner.get_bytes", fake_get_bytes)
    monkeypatch.setattr("services.compiler_worker.app.pipeline.runner.generate_embedding", fake_generate_embedding)
    monkeypatch.setattr("services.compiler_worker.app.pipeline.runner._extract_entities_and_graph", fake_extract)
    yield storage


async def _create_test_session(display_name: str, email_prefix: str) -> tuple[str, str]:
    email = f"{email_prefix}-{uuid.uuid4().hex[:6]}@test.com"
    user_id = await register_user(email, "testpass12345", display_name)
    pool = await get_db_pool()
    async with pool.acquire() as connection:
        organization = await connection.fetchrow(
            """
            INSERT INTO organizations (name, slug)
            VALUES ($1, $2)
            RETURNING id::text AS id
            """,
            f"{display_name} Organization",
            f"{email_prefix}-{uuid.uuid4().hex[:8]}",
        )
        await connection.execute(
            """
            INSERT INTO organization_members (organization_id, user_id, role)
            VALUES ($1::uuid, $2::uuid, 'owner')
            """,
            organization["id"],
            user_id,
        )
    workspace_id = await bootstrap_workspace(organization["id"], f"{display_name} Vault", "worker test workspace")
    token = await issue_session(Response(), user_id)
    return workspace_id, token


async def test_worker_end_to_end_ingest() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        workspace_id, token = await _create_test_session("WorkerE2E", "worker-e2e")
        client.cookies.set("llm_wiki_session", token)

        settings_payload = {
            "llm_provider": "openai",
            "llm_model": "fake-model",
            "llm_api_key": "fake-llm-key",
            "llm_base_url": "http://fake-llm.local/v1",
            "embedding_provider": "openai",
            "embedding_model": "fake-embedding",
            "embedding_api_key": "fake-embedding-key",
            "embedding_base_url": "http://fake-embedding.local/v1",
            "compiler_rules": {},
            "search_rules": {},
        }
        update_settings = await client.put(f"/v1/workspaces/{workspace_id}/settings", json=settings_payload)
        assert update_settings.status_code == 200

        upload = await client.post(
            f"/v1/workspaces/{workspace_id}/documents/upload",
            files={"file": ("source.md", b"# Widget\n\nWidget is important.", "text/markdown")},
            data={"title": "Widget Source", "source_path": "/sources/"},
        )
        assert upload.status_code == 200
        source_document_id = upload.json()["data"]["document_id"]

    msg_id, run_id, queued_workspace_id, trace_carrier, attempts = await pop_run("worker-e2e", timeout_ms=2000)
    assert msg_id is not None
    assert run_id is not None
    assert queued_workspace_id == workspace_id

    await worker_main._handle(msg_id, run_id, workspace_id, trace_carrier, attempts)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        client.cookies.set("llm_wiki_session", token)
        run = await client.get(f"/v1/runs/{run_id}")
        assert run.status_code == 200
        assert run.json()["data"]["status"] == "succeeded"

        pages = await client.get(f"/v1/documents/{source_document_id}/pages")
        assert pages.status_code == 200
        assert len(pages.json()["data"]) >= 1

        wiki_docs = await client.get(f"/v1/workspaces/{workspace_id}/documents?kind=wiki")
        assert wiki_docs.status_code == 200
        assert any(doc["path"] == "/wiki/concepts/widget.md" for doc in wiki_docs.json()["data"])


async def test_worker_retries_transient_failure(monkeypatch) -> None:
    original_process_run = worker_main.process_run
    attempt_counter = {"count": 0}

    async def flaky_process_run(run_id: str, workspace_id: str, attempts: int = 1):
        attempt_counter["count"] += 1
        if attempt_counter["count"] == 1:
            raise RuntimeError("temporary failure")
        return await original_process_run(run_id, workspace_id, attempts=attempts)

    monkeypatch.setattr(worker_main, "process_run", flaky_process_run)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        workspace_id, token = await _create_test_session("WorkerRetry", "worker-retry")
        client.cookies.set("llm_wiki_session", token)

        settings_payload = {
            "llm_provider": "openai",
            "llm_model": "fake-model",
            "llm_api_key": "fake-llm-key",
            "llm_base_url": "http://fake-llm.local/v1",
            "embedding_provider": "openai",
            "embedding_model": "fake-embedding",
            "embedding_api_key": "fake-embedding-key",
            "embedding_base_url": "http://fake-embedding.local/v1",
            "compiler_rules": {},
            "search_rules": {},
        }
        update_settings = await client.put(f"/v1/workspaces/{workspace_id}/settings", json=settings_payload)
        assert update_settings.status_code == 200

        upload = await client.post(
            f"/v1/workspaces/{workspace_id}/documents/upload",
            files={"file": ("source.md", b"# Widget\n\nWidget is important.", "text/markdown")},
            data={"title": "Retry Source", "source_path": "/sources/"},
        )
        assert upload.status_code == 200

    msg_id, run_id, queued_workspace_id, trace_carrier, attempts = await pop_run("worker-retry", timeout_ms=2000)
    assert queued_workspace_id == workspace_id

    await worker_main._handle(msg_id, run_id, workspace_id, trace_carrier, attempts)

    depths_after_retry = await get_queue_depths()
    assert depths_after_retry["stream"] >= 1
    assert depths_after_retry["dlq"] == 0

    msg_id_retry, run_id_retry, workspace_id_retry, trace_retry, retry_attempt = await pop_run("worker-retry", timeout_ms=2000)
    assert run_id_retry == run_id
    assert workspace_id_retry == workspace_id

    await worker_main._handle(msg_id_retry, run_id_retry, workspace_id_retry, trace_retry, retry_attempt)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        client.cookies.set("llm_wiki_session", token)
        run = await client.get(f"/v1/runs/{run_id}")
        assert run.status_code == 200
        assert run.json()["data"]["status"] == "succeeded"

        steps = await client.get(f"/v1/runs/{run_id}/steps")
        assert steps.status_code == 200
        assert any(step["step_key"] == "retry_scheduled" for step in steps.json()["data"])

    dlq_messages = await list_dlq()
    assert dlq_messages == []

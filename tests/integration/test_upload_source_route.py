from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from llm_wiki_core.security import AuthContext
from services.platform_api.app.core.deps import get_workspace_conn, require_workspace_access
from services.platform_api.app.main import app


class FakeTransaction:
    async def __aenter__(self) -> "FakeTransaction":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None


class FakeConnection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.document_id = "doc-1"
        self.run_id = "run-1"

    async def __aenter__(self) -> "FakeConnection":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    def transaction(self) -> FakeTransaction:
        return FakeTransaction()

    async def fetchrow(self, query: str, *args: Any) -> dict[str, Any]:
        self.calls.append((query, args))
        if "INSERT INTO documents" in query:
            return {"id": self.document_id}
        if "INSERT INTO document_revisions" in query:
            return {"id": "rev-1"}
        if "INSERT INTO runs" in query:
            return {"id": self.run_id}
        raise AssertionError(f"Unexpected fetchrow query: {query}")

    async def execute(self, query: str, *args: Any) -> str:
        self.calls.append((query, args))
        return "OK"


def test_upload_source_route(monkeypatch) -> None:
    from services.platform_api.app import main as main_module
    from services.platform_api.app.api.routes import documents as documents_module

    logged: list[dict[str, Any]] = []
    queued: list[str] = []
    stored: list[tuple[str, bytes, str]] = []
    fake_connection = FakeConnection()

    async def noop() -> None:
        return None

    async def fake_enqueue(run_id: str, workspace_id: str, idempotency_key: str | None = None) -> bool:
        queued.append(run_id)

    async def fake_log_activity(**kwargs: Any) -> None:
        logged.append(kwargs)

    def fake_put_bytes(key: str, data: bytes, content_type: str) -> None:
        stored.append((key, data, content_type))

    monkeypatch.setattr(documents_module, "enqueue_run", fake_enqueue)
    monkeypatch.setattr(documents_module, "record_activity", fake_log_activity)
    monkeypatch.setattr(documents_module, "put_bytes", fake_put_bytes)
    monkeypatch.setattr(main_module, "init_db_pool", noop)
    monkeypatch.setattr(main_module, "close_db_pool", noop)
    monkeypatch.setattr(main_module, "close_redis", noop)

    app.dependency_overrides[require_workspace_access] = lambda workspace_id: AuthContext(
        actor_type="human",
        actor_id="user-1",
        user_id="user-1",
        organization_id="org-1",
        workspace_roles={workspace_id: "owner"},
        token_scope="admin",
    )
    async def override_workspace_conn(workspace_id: str):
        yield fake_connection

    app.dependency_overrides[get_workspace_conn] = override_workspace_conn

    client = TestClient(app)
    response = client.post(
        "/v1/workspaces/workspace-1/documents/upload",
        files={"file": ("notes.md", b"# Title\n\nBody", "text/markdown")},
        data={"title": "Quarterly Notes", "source_path": "/sources/notes/"},
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["document_id"] == "doc-1"
    assert payload["run_id"] == "run-1"
    assert stored[0][0] == "workspace-1/sources/notes/quarterly-notes.md"
    assert queued == ["run-1"]
    assert logged[0]["event_type"] == "source.uploaded"

    app.dependency_overrides.clear()

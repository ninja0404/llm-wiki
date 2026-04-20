from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from llm_wiki_core.security import AuthContext
from services.platform_api.app.core.deps import require_auth
from services.platform_api.app.main import app


class FakePool:
    def __init__(self) -> None:
        self.rows = {
            "diff": {
                "content_md": "alpha\nbeta-2\ngamma\ndelta",
                "previous_content_md": "alpha\nbeta\ngamma",
                "workspace_id": "workspace-1",
            }
        }

    async def fetchrow(self, query: str, *args: Any) -> dict[str, Any] | None:
        if "FROM document_revisions dr" in query and "previous_content_md" in query:
            return self.rows["diff"]
        return None


async def fake_pool() -> FakePool:
    return FakePool()


class FakeAcquire:
    def __init__(self) -> None:
        self.pool = FakePool()

    async def __aenter__(self) -> FakePool:
        return self.pool

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None


def test_revision_diff_api(monkeypatch) -> None:
    from services.platform_api.app import main as main_module
    from services.platform_api.app.api.routes import revisions as revisions_module

    async def noop() -> None:
        return None

    monkeypatch.setattr(revisions_module, "acquire", lambda workspace_id: FakeAcquire())
    monkeypatch.setattr(main_module, "init_db_pool", noop)
    monkeypatch.setattr(main_module, "close_db_pool", noop)
    monkeypatch.setattr(main_module, "close_redis", noop)
    app.dependency_overrides[require_auth] = lambda: AuthContext(
        actor_type="human",
        actor_id="user-1",
        user_id="user-1",
        organization_id="org-1",
        workspace_roles={"workspace-1": "owner"},
        token_scope="admin",
    )

    client = TestClient(app)
    response = client.get("/v1/revisions/rev-1/diff")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["stats"]["added"] == 2
    assert payload["stats"]["removed"] == 1
    assert any(line["type"] == "added" and line["text"] == "delta" for line in payload["lines"])

    app.dependency_overrides.clear()

"""Consolidated integration tests. Uses a single ASGI client to avoid pool/lifespan conflicts."""
from __future__ import annotations

import uuid

from fastapi import Response
from httpx import ASGITransport, AsyncClient
from llm_wiki_core.db import get_db_pool
from services.platform_api.app.core.deps import issue_session, register_user
from services.platform_api.app.services.workspace import bootstrap_workspace
from services.platform_api.app.main import app


async def test_all_api():
    """All integration tests in one session to avoid asyncpg pool/lifespan conflicts."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        email = f"api-{uuid.uuid4().hex[:6]}@test.com"
        user_id = await register_user(email, "testpass12345", "Tester")
        pool = await get_db_pool()
        async with pool.acquire() as connection:
            organization = await connection.fetchrow(
                """
                INSERT INTO organizations (name, slug)
                VALUES ($1, $2)
                RETURNING id::text AS id
                """,
                "Tester Organization",
                f"api-{uuid.uuid4().hex[:8]}",
            )
            await connection.execute(
                """
                INSERT INTO organization_members (organization_id, user_id, role)
                VALUES ($1::uuid, $2::uuid, 'owner')
                """,
                organization["id"],
                user_id,
            )
        token = await issue_session(Response(), user_id)
        c.cookies.set("llm_wiki_session", token)
        await bootstrap_workspace(organization["id"], "Core Vault", "Primary compiled knowledge workspace")
        ws_id = (await c.get("/v1/workspaces")).json()["data"][0]["id"]

        # ── Graph API ──

        r = await c.get(f"/v1/workspaces/{ws_id}/graph")
        assert r.status_code == 200
        d = r.json()["data"]
        assert d["workspace_id"] == ws_id
        assert isinstance(d["nodes"], list) and isinstance(d["edges"], list)
        for k in ("entity_count", "claim_count", "relation_count", "citation_count", "document_count", "truncated"):
            assert k in d["summary"]
        assert len({n["id"] for n in d["nodes"]}) == len(d["nodes"])
        assert len({e["id"] for e in d["edges"]}) == len(d["edges"])

        r2 = await c.get(f"/v1/workspaces/{ws_id}/graph?include_claims=false")
        assert all(n["type"] != "claim" for n in r2.json()["data"]["nodes"])

        r3 = await c.get(f"/v1/workspaces/{ws_id}/graph?focus_document_id=00000000-0000-0000-0000-000000000099")
        assert r3.status_code == 200

        # ── Create Path Semantics ──

        cr = await c.post(f"/v1/workspaces/{ws_id}/documents/wiki", json={
            "path": "/wiki/concepts/foo.md", "title": "Foo", "content": "Hello"
        })
        assert cr.status_code == 200
        assert cr.json()["data"]["path"] == "/wiki/concepts/foo.md"

        cr2 = await c.post(f"/v1/workspaces/{ws_id}/documents/wiki", json={
            "path": "/wiki/concepts/", "title": "Foo", "content": "Hello"
        })
        assert cr2.status_code == 400

        cr3 = await c.post(f"/v1/workspaces/{ws_id}/documents/wiki", json={
            "path": "/wiki/concepts/foo", "title": "Foo", "content": "Hello"
        })
        assert cr3.status_code == 400

        cr4 = await c.post(f"/v1/workspaces/{ws_id}/documents/wiki", json={
            "path": "/test/w.md", "title": "W", "content": "test"
        })
        assert cr4.status_code == 200
        assert "/w.md/w.md" not in cr4.json()["data"]["path"]

        cr5 = await c.post(f"/v1/workspaces/{ws_id}/documents/wiki", json={
            "path": "wiki/bar.md", "title": "Bar", "content": "test"
        })
        assert cr5.status_code == 200
        assert cr5.json()["data"]["path"] == "/wiki/bar.md"

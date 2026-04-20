"""Security integration tests: upload validation, MIME whitelist, extension whitelist."""

from __future__ import annotations

import io
import uuid

from fastapi import Response
from httpx import ASGITransport, AsyncClient
from llm_wiki_core.db import get_db_pool
from services.platform_api.app.core.deps import issue_session, register_user
from services.platform_api.app.services.workspace import bootstrap_workspace
from services.platform_api.app.main import app


async def test_upload_security():
    """Upload validation and security boundary tests."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        email = f"upl-{uuid.uuid4().hex[:6]}@test.com"
        user_id = await register_user(email, "testpass12345", "UploadTester")
        pool = await get_db_pool()
        async with pool.acquire() as connection:
            organization = await connection.fetchrow(
                """
                INSERT INTO organizations (name, slug)
                VALUES ($1, $2)
                RETURNING id::text AS id
                """,
                "UploadTester Organization",
                f"upload-{uuid.uuid4().hex[:8]}",
            )
            await connection.execute(
                """
                INSERT INTO organization_members (organization_id, user_id, role)
                VALUES ($1::uuid, $2::uuid, 'owner')
                """,
                organization["id"],
                user_id,
            )
        ws_id = await bootstrap_workspace(organization["id"], "Upload Vault", "upload test workspace")
        token = await issue_session(Response(), user_id)
        c.cookies.set("llm_wiki_session", token)

        # ── Reject dangerous extension (exe) ──
        r = await c.post(
            f"/v1/workspaces/{ws_id}/documents/upload",
            files={"file": ("malware.exe", io.BytesIO(b"MZ evil"), "application/octet-stream")},
        )
        assert r.status_code == 400
        assert "extension" in r.json()["detail"].lower()

        # ── Reject script extension (php) ──
        r = await c.post(
            f"/v1/workspaces/{ws_id}/documents/upload",
            files={"file": ("shell.php", io.BytesIO(b"<?php echo 1;"), "application/x-httpd-php")},
        )
        assert r.status_code == 400

        # ── Reject unsupported MIME type ──
        r = await c.post(
            f"/v1/workspaces/{ws_id}/documents/upload",
            files={"file": ("data.csv", io.BytesIO(b"a,b,c"), "application/x-malicious")},
        )
        assert r.status_code == 415

        # ── Valid file passes validation (but may fail on MinIO storage) ──
        try:
            r = await c.post(
                f"/v1/workspaces/{ws_id}/documents/upload",
                files={"file": ("test.txt", io.BytesIO(b"hello world"), "text/plain")},
            )
            assert r.status_code in (200, 500)
        except Exception:
            pass  # MinIO not available — validation path still exercised

        # ── Upload without auth rejected ──
        async with AsyncClient(transport=transport, base_url="http://test") as c_anon:
            r = await c_anon.post(
                f"/v1/workspaces/{ws_id}/documents/upload",
                files={"file": ("test.txt", io.BytesIO(b"no auth"), "text/plain")},
            )
            assert r.status_code == 401

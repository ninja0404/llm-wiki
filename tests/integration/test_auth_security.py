"""Security integration tests: session revocation, token expiry, cross-workspace access."""

from __future__ import annotations

import uuid

from httpx import ASGITransport, AsyncClient
from services.platform_api.app.main import app


async def test_auth_security():
    """All auth security tests in one session to avoid pool conflicts."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        email = f"sec-{uuid.uuid4().hex[:6]}@test.com"

        # ── Register + Login ──
        reg = await c.post("/v1/auth/register", json={
            "email": email, "password": "testpass12345", "display_name": "SecTester",
        })
        assert reg.status_code == 200

        me = await c.get("/v1/auth/me")
        assert me.status_code == 200
        assert me.json()["data"]["email"] == email

        # ── Logout revokes session ──
        logout = await c.post("/v1/auth/logout")
        assert logout.status_code == 200

        me_after_logout = await c.get("/v1/auth/me")
        assert me_after_logout.status_code == 401, "Session should be revoked after logout"

        # ── Re-login ──
        login = await c.post("/v1/auth/login", json={"email": email, "password": "testpass12345"})
        assert login.status_code == 200

        me2 = await c.get("/v1/auth/me")
        assert me2.status_code == 200

        # ── Bad password rejected ──
        bad_login = await c.post("/v1/auth/login", json={"email": email, "password": "wrongpass123"})
        assert bad_login.status_code == 401

        # ── Duplicate registration rejected ──
        dup = await c.post("/v1/auth/register", json={
            "email": email, "password": "testpass12345", "display_name": "Dup",
        })
        assert dup.status_code == 409

        # ── Invalid token rejected ──
        fake_h = {"Authorization": "Bearer fake-jwt-token-that-is-invalid"}
        async with AsyncClient(transport=transport, base_url="http://test") as c_invalid:
            fake_me = await c_invalid.get("/v1/auth/me", headers=fake_h)
        assert fake_me.status_code == 401

        # ── No auth rejected (fresh client without cookies) ──
        async with AsyncClient(transport=transport, base_url="http://test") as c_anon:
            no_auth = await c_anon.get("/v1/auth/me")
            assert no_auth.status_code == 401

        # ── Cross-workspace access denied ──
        ws_list = await c.get("/v1/workspaces")
        ws_id = ws_list.json()["data"][0]["id"]

        fake_ws = "00000000-0000-0000-0000-000000000099"
        cross_ws = await c.get(f"/v1/workspaces/{fake_ws}/documents")
        assert cross_ws.status_code == 403, "Access to non-member workspace should be denied"

        dlq = await c.get("/v1/admin/dlq")
        assert dlq.status_code == 403

        # ── Agent token on non-workspace route is rejected ──
        bad_agent = {"Authorization": "Bearer lwa_invalid_token_that_does_not_exist"}
        agent_me = await c.get("/v1/auth/me", headers=bad_agent)
        assert agent_me.status_code == 403

        # ── Agent token creation + scope enforcement ──
        create_token = await c.post(f"/v1/workspaces/{ws_id}/agent-tokens", json={
            "name": "test-token", "scope": "read", "expires_in_days": 30,
        })
        assert create_token.status_code == 200
        agent_token = create_token.json()["data"]["token"]
        assert create_token.json()["data"]["expires_at"] is not None

        agent_h = {"Authorization": f"Bearer {agent_token}"}
        agent_docs = await c.get(f"/v1/workspaces/{ws_id}/documents", headers=agent_h)
        assert agent_docs.status_code == 200

        # ── Agent token revocation ──
        token_id = create_token.json()["data"]["id"]
        revoke = await c.delete(f"/v1/workspaces/{ws_id}/agent-tokens/{token_id}")
        assert revoke.status_code == 200

        agent_after_revoke = await c.get(f"/v1/workspaces/{ws_id}/documents", headers=agent_h)
        assert agent_after_revoke.status_code == 401, "Revoked token should be rejected"

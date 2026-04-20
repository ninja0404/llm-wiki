from __future__ import annotations

import uuid

from httpx import ASGITransport, AsyncClient
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from services.mcp_service.app import main as mcp_main_module
from services.platform_api.app.core.deps import create_workspace_agent_token, register_user
from services.platform_api.app.services.workspace import bootstrap_workspace
from llm_wiki_core.db import get_db_pool


async def test_mcp_streamable_http_e2e() -> None:
    email = f"mcp-e2e-{uuid.uuid4().hex[:6]}@test.com"
    user_id = await register_user(email, "testpass12345", "McpE2E")
    pool = await get_db_pool()
    async with pool.acquire() as connection:
        organization = await connection.fetchrow(
            """
            INSERT INTO organizations (name, slug)
            VALUES ($1, $2)
            RETURNING id::text AS id
            """,
            "McpE2E Organization",
            f"mcp-e2e-{uuid.uuid4().hex[:8]}",
        )
        await connection.execute(
            """
            INSERT INTO organization_members (organization_id, user_id, role)
            VALUES ($1::uuid, $2::uuid, 'owner')
            """,
            organization["id"],
            user_id,
        )
    workspace_id = await bootstrap_workspace(organization["id"], "MCP Vault", "MCP test workspace")
    async with pool.acquire() as connection:
        await connection.execute(
            """
            UPDATE workspace_settings
            SET search_rules = $2::jsonb
            WHERE workspace_id = $1::uuid
            """,
            workspace_id,
            {"enable_semantic": False},
        )
    token_data = await create_workspace_agent_token(workspace_id, user_id, "mcp-e2e", "write", 30)
    agent_token = token_data["token"]

    async with mcp_main_module.mcp_app.router.lifespan_context(mcp_main_module.mcp_app):
        mcp_transport = ASGITransport(app=mcp_main_module.app)
        async with AsyncClient(transport=mcp_transport, base_url="http://localhost") as http_client:
            async with streamable_http_client("http://localhost/mcp", http_client=http_client) as (read_stream, write_stream, _get_session_id):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    tools = await session.list_tools()
                    tool_names = {tool.name for tool in tools.tools}
                    assert {"create", "read", "search"} <= tool_names

                    created = await session.call_tool(
                        "create",
                        {
                            "workspace_id": workspace_id,
                            "agent_token": agent_token,
                            "path": "/wiki/concepts/mcp-e2e.md",
                            "title": "MCP E2E",
                            "content": "MCP content",
                        },
                    )
                    assert created.isError is False
                    assert "Created `/wiki/concepts/mcp-e2e.md`." in created.content[0].text

                    read = await session.call_tool(
                        "read",
                        {
                            "workspace_id": workspace_id,
                            "agent_token": agent_token,
                            "path": "/wiki/concepts/mcp-e2e.md",
                        },
                    )
                    assert read.isError is False
                    assert "MCP content" in read.content[0].text

                    search = await session.call_tool(
                        "search",
                        {
                            "workspace_id": workspace_id,
                            "agent_token": agent_token,
                            "mode": "search",
                            "query": "MCP E2E",
                            "limit": 5,
                        },
                    )
                    assert search.isError is False
                    assert "/wiki/concepts/mcp-e2e.md" in search.content[0].text

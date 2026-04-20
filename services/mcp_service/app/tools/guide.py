from mcp.server.fastmcp import FastMCP

from llm_wiki_core.db import acquire

from ..core.auth import validate_agent


def register_guide_tool(mcp: FastMCP) -> None:
    @mcp.tool(name="guide", description="Explain the LLM Wiki workspace contract and list workspace stats.")
    async def guide(workspace_id: str, agent_token: str) -> str:
        await validate_agent(workspace_id, agent_token, "guide")
        async with acquire(workspace_id) as connection:
            stats = await connection.fetchrow(
                """
                SELECT
                  (SELECT COUNT(*) FROM documents WHERE workspace_id = $1::uuid AND kind = 'source' AND archived_at IS NULL) AS source_count,
                  (SELECT COUNT(*) FROM documents WHERE workspace_id = $1::uuid AND kind IN ('wiki', 'system') AND archived_at IS NULL) AS wiki_count,
                  (SELECT COUNT(*) FROM runs WHERE workspace_id = $1::uuid) AS run_count
                """,
                workspace_id,
            )
        return f"""# LLM Wiki Workspace Guide

This workspace is a compiled knowledge vault with two operating engines:
- System compiler: parses sources, updates graph state, applies structured change plans.
- Agent operating plane: reads sources/wiki and creates or edits agent-safe wiki documents.

## Structural paths
- `/wiki/overview.md`
- `/wiki/log.md`
- `/wiki/entities/*`
- `/wiki/concepts/*`
- `/wiki/comparisons/*`
- `/wiki/timelines/*`
- `/sources/*`
- `/assets/*`

## Writing rules
- `overview.md` must stay current after meaningful ingest or agent edits.
- `log.md` is append-only.
- Every factual page should include citations back to source blocks or pages.
- Every wiki page should include at least one table, mermaid chart, or figure.

## Current stats
- Sources: {stats['source_count']}
- Wiki Pages: {stats['wiki_count']}
- Runs: {stats['run_count']}
"""

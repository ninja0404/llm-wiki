from mcp.server.fastmcp import FastMCP

from llm_wiki_core.db import acquire

from ..core.auth import validate_agent


def register_lint_tool(mcp: FastMCP) -> None:
    @mcp.tool(name="lint", description="Inspect the workspace for missing structural pages and empty wiki documents.")
    async def lint(workspace_id: str, agent_token: str, scope: str = "/wiki/") -> str:
        await validate_agent(workspace_id, agent_token, "lint")
        async with acquire(workspace_id) as connection:
            docs = await connection.fetch(
                """
                SELECT path, title, dr.content_md
                FROM documents d
                LEFT JOIN document_revisions dr ON dr.id = d.current_revision_id
                WHERE d.workspace_id = $1::uuid
                  AND d.archived_at IS NULL
                  AND d.path LIKE $2
                ORDER BY d.path
                """,
                workspace_id,
                f"{scope.rstrip('/')}%",
            )
        findings = []
        existing_paths = {row["path"] for row in docs}
        for required in ("/wiki/overview.md", "/wiki/log.md"):
            if required not in existing_paths:
                findings.append(f"- Missing structural page: `{required}`")
        for row in docs:
            content = row["content_md"] or ""
            if len(content.strip()) < 40:
                findings.append(f"- Sparse document: `{row['path']}`")
            if row["path"].startswith("/wiki/") and "```mermaid" not in content and "|" not in content:
                findings.append(f"- Missing visual structure: `{row['path']}`")
        return "\n".join(findings) if findings else "No lint findings."

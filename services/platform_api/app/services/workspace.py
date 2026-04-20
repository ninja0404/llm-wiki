from __future__ import annotations

import re
from datetime import UTC, datetime

from llm_wiki_core.db import get_db_pool
from llm_wiki_core.write_journal import create_document, create_revision, record_activity, set_document_revision


OVERVIEW_TEMPLATE = """This workspace is an agent-native compiled knowledge vault.

## Key Findings

| Signal | Value |
| --- | --- |
| Sources | 0 |
| Wiki Pages | 2 |
| Runs | 0 |

```mermaid
graph TD
    Sources[Sources] --> Compiler[Compiler]
    Compiler --> Wiki[Wiki]
    Wiki --> Agents[Agents]
```

## Recent Updates

- Workspace initialized.
"""

LOG_TEMPLATE = """## [{date}] created | Workspace Initialized
- Created `overview.md`
- Created `log.md`
- Ready for ingest runs
"""


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "workspace"


async def bootstrap_workspace(organization_id: str, name: str, description: str | None = None) -> str:
    pool = await get_db_pool()
    slug = slugify(name)
    existing = await pool.fetchval(
        "SELECT 1 FROM workspaces WHERE organization_id = $1::uuid AND slug = $2",
        organization_id,
        slug,
    )
    counter = 1
    base_slug = slug
    while existing:
        counter += 1
        slug = f"{base_slug}-{counter}"
        existing = await pool.fetchval(
            "SELECT 1 FROM workspaces WHERE organization_id = $1::uuid AND slug = $2",
            organization_id,
            slug,
        )

    async with pool.acquire() as connection:
        async with connection.transaction():
            workspace = await connection.fetchrow(
                """
                INSERT INTO workspaces (organization_id, slug, name, description)
                VALUES ($1::uuid, $2, $3, $4)
                RETURNING id::text AS id
                """,
                organization_id,
                slug,
                name,
                description,
            )
            workspace_id = workspace["id"]
            await connection.execute(
                """
                INSERT INTO workspace_settings (workspace_id)
                VALUES ($1::uuid)
                """,
                workspace_id,
            )
            overview_doc = await create_document(
                connection,
                workspace_id=workspace_id,
                kind="system",
                path="/wiki/overview.md",
                title="Overview",
                mime_type="text/markdown",
                status="ready",
                policy="system_managed",
            )
            overview_revision = await create_revision(
                connection,
                document_id=overview_doc.id,
                actor_type="system",
                actor_id="workspace-bootstrap",
                run_id=None,
                reason="Initialize overview",
                content_md=OVERVIEW_TEMPLATE,
                diff_summary={"type": "bootstrap"},
            )
            await set_document_revision(connection, overview_doc.id, overview_revision.id)

            log_doc = await create_document(
                connection,
                workspace_id=workspace_id,
                kind="system",
                path="/wiki/log.md",
                title="Log",
                mime_type="text/markdown",
                status="ready",
                policy="append_only",
            )
            log_revision = await create_revision(
                connection,
                document_id=log_doc.id,
                actor_type="system",
                actor_id="workspace-bootstrap",
                run_id=None,
                reason="Initialize log",
                content_md=LOG_TEMPLATE.format(date=datetime.now(UTC).date().isoformat()),
                diff_summary={"type": "bootstrap"},
            )
            await set_document_revision(connection, log_doc.id, log_revision.id)
            await record_activity(
                workspace_id=workspace_id,
                actor_type="system",
                actor_id="workspace-bootstrap",
                event_type="workspace.bootstrap",
                payload={"name": name, "description": description},
                connection=connection,
            )
    return workspace_id

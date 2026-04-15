from __future__ import annotations

import re
from datetime import datetime

from llm_wiki_core.audit import log_activity
from llm_wiki_core.db import get_db_pool


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
            overview_doc = await connection.fetchrow(
                """
                INSERT INTO documents (workspace_id, kind, path, title, mime_type, status, policy)
                VALUES ($1::uuid, 'system', '/wiki/overview.md', 'Overview', 'text/markdown', 'ready', 'system_managed')
                RETURNING id::text AS id
                """,
                workspace_id,
            )
            overview_revision = await connection.fetchrow(
                """
                INSERT INTO document_revisions (document_id, actor_type, actor_id, reason, content_md, content_ast, diff_summary)
                VALUES ($1::uuid, 'system', 'workspace-bootstrap', 'Initialize overview', $2, '{}'::jsonb, '{"type":"bootstrap"}'::jsonb)
                RETURNING id::text AS id
                """,
                overview_doc["id"],
                OVERVIEW_TEMPLATE,
            )
            await connection.execute(
                "UPDATE documents SET current_revision_id = $1::uuid WHERE id = $2::uuid",
                overview_revision["id"],
                overview_doc["id"],
            )

            log_doc = await connection.fetchrow(
                """
                INSERT INTO documents (workspace_id, kind, path, title, mime_type, status, policy)
                VALUES ($1::uuid, 'system', '/wiki/log.md', 'Log', 'text/markdown', 'ready', 'append_only')
                RETURNING id::text AS id
                """,
                workspace_id,
            )
            log_revision = await connection.fetchrow(
                """
                INSERT INTO document_revisions (document_id, actor_type, actor_id, reason, content_md, content_ast, diff_summary)
                VALUES ($1::uuid, 'system', 'workspace-bootstrap', 'Initialize log', $2, '{}'::jsonb, '{"type":"bootstrap"}'::jsonb)
                RETURNING id::text AS id
                """,
                log_doc["id"],
                LOG_TEMPLATE.format(date=datetime.utcnow().date().isoformat()),
            )
            await connection.execute(
                "UPDATE documents SET current_revision_id = $1::uuid WHERE id = $2::uuid",
                log_revision["id"],
                log_doc["id"],
            )
    await log_activity(
        workspace_id=workspace_id,
        actor_type="system",
        actor_id="workspace-bootstrap",
        event_type="workspace.bootstrap",
        payload={"name": name, "description": description},
    )
    return workspace_id

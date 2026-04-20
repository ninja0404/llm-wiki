from __future__ import annotations

from typing import Any

import orjson

from .db import acquire


async def log_activity(
    workspace_id: str,
    actor_type: str,
    actor_id: str | None,
    event_type: str,
    payload: dict[str, Any] | None = None,
    document_id: str | None = None,
    run_id: str | None = None,
    connection=None,
) -> None:
    async def _write_activity(conn) -> None:
        await conn.execute(
            """
            INSERT INTO activity_events (workspace_id, actor_type, actor_id, event_type, document_id, run_id, payload)
            VALUES ($1::uuid, $2::actor_type, $3, $4, $5::uuid, $6::uuid, $7::jsonb)
            """,
            workspace_id,
            actor_type,
            actor_id,
            event_type,
            document_id,
            run_id,
            orjson.dumps(payload or {}).decode(),
        )

    if connection is not None:
        await _write_activity(connection)
        return

    async with acquire(workspace_id) as conn:
        await _write_activity(conn)

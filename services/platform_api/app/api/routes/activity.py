from typing import Annotated

from fastapi import APIRouter, Depends

from ...core.deps import AuthContext, get_workspace_conn, require_workspace_access


router = APIRouter(tags=["activity"])


@router.get("/v1/workspaces/{workspace_id}/activity")
async def list_activity(
    workspace_id: str,
    auth: Annotated[AuthContext, Depends(require_workspace_access)],
    connection=Depends(get_workspace_conn),
) -> dict:
    rows = await connection.fetch(
        """
        SELECT ae.id::text AS id, ae.actor_type::text AS actor_type, ae.actor_id, ae.event_type,
               ae.document_id::text AS document_id, ae.run_id::text AS run_id, ae.payload, ae.created_at,
               d.path AS document_path, d.title AS document_title
        FROM activity_events ae
        LEFT JOIN documents d ON d.id = ae.document_id
        WHERE ae.workspace_id = $1::uuid
        ORDER BY ae.created_at DESC
        LIMIT 100
        """,
        workspace_id,
    )
    return {"data": [dict(row) for row in rows]}

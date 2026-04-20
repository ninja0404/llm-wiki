from __future__ import annotations

import io
import zipfile
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from ...core.deps import AuthContext, get_workspace_conn, require_workspace_access


router = APIRouter(tags=["exports"])


@router.get("/v1/workspaces/{workspace_id}/exports/markdown")
async def export_markdown(
    workspace_id: str,
    auth: Annotated[AuthContext, Depends(require_workspace_access)],
    connection=Depends(get_workspace_conn),
) -> StreamingResponse:
    rows = await connection.fetch(
        """
        SELECT d.path, dr.content_md
        FROM documents d
        JOIN document_revisions dr ON dr.id = d.current_revision_id
        WHERE d.workspace_id = $1::uuid
          AND d.archived_at IS NULL
          AND d.kind IN ('wiki', 'system')
        ORDER BY d.path
        """,
        workspace_id,
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for row in rows:
            archive.writestr(row["path"].lstrip("/"), row["content_md"] or "")
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="workspace-{workspace_id}.zip"'},
    )

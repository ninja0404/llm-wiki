from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated

import structlog
from fastapi import Cookie, Depends, Header, HTTPException, Request, Response, status

from llm_wiki_core.config import get_settings
from llm_wiki_core.db import acquire, get_db_pool
from llm_wiki_core.security import (
    AuthContext,
    create_session_token,
    generate_agent_token,
    hash_agent_token,
    hash_session_token,
    hash_password,
    verify_password,
)


SESSION_COOKIE = "llm_wiki_session"
VALID_AGENT_SCOPES = {"read", "write", "admin"}
SESSION_TTL = timedelta(days=7)


async def require_auth(
    request: Request,
    workspace_id: str | None = None,
    session_cookie: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> AuthContext:
    pool = await get_db_pool()
    token = session_cookie

    if authorization and authorization.startswith("Bearer "):
        raw = authorization[7:]
        if raw.startswith("lwa_"):
            if not workspace_id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Agent tokens require a workspace-scoped route")
            async with acquire(workspace_id) as connection:
                row = await connection.fetchrow(
                    """
                    SELECT workspace_id::text AS workspace_id, scope, id::text AS token_id
                    FROM agent_tokens
                    WHERE token_hash = $1
                      AND revoked_at IS NULL
                      AND (expires_at IS NULL OR expires_at > NOW())
                    """,
                    hash_agent_token(raw),
                )
                if not row:
                    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid agent token")
                if row["scope"] not in VALID_AGENT_SCOPES:
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Token has invalid scope '{row['scope']}'")
                await connection.execute(
                    "UPDATE agent_tokens SET last_used_at = NOW() WHERE id = $1::uuid",
                    row["token_id"],
                )
            if not row:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid agent token")
            return AuthContext(
                actor_type="agent",
                actor_id=row["token_id"],
                token_scope=row["scope"],
                workspace_roles={row["workspace_id"]: "admin"},
            )

    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    session = await pool.fetchrow(
        """
        SELECT user_id::text AS user_id
        FROM sessions
        WHERE token_hash = $1
          AND expires_at > NOW()
          AND revoked_at IS NULL
          AND rotated_at IS NULL
        """,
        hash_session_token(token),
    )
    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    user_id = session["user_id"]

    memberships = await pool.fetch(
        """
        SELECT w.id::text AS workspace_id, om.role::text AS role, o.id::text AS organization_id
        FROM organization_members om
        JOIN organizations o ON o.id = om.organization_id
        JOIN workspaces w ON w.organization_id = o.id
        WHERE om.user_id = $1::uuid
        """,
        user_id,
    )
    workspace_roles = {row["workspace_id"]: row["role"] for row in memberships}
    organization_id = memberships[0]["organization_id"] if memberships else None
    is_platform_admin = bool(await pool.fetchval("SELECT is_platform_admin FROM users WHERE id = $1::uuid", user_id))
    return AuthContext(
        actor_type="human",
        actor_id=user_id,
        user_id=user_id,
        organization_id=organization_id,
        workspace_roles=workspace_roles,
        token_scope="admin",
        is_platform_admin=is_platform_admin,
    )


async def require_workspace_access(
    workspace_id: str,
    auth: Annotated[AuthContext, Depends(require_auth)],
) -> AuthContext:
    if workspace_id in (auth.workspace_roles or {}):
        structlog.contextvars.bind_contextvars(workspace_id=workspace_id)
        return auth
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Workspace access denied")


async def get_workspace_conn(
    workspace_id: str,
    auth: Annotated[AuthContext, Depends(require_workspace_access)],
):
    """FastAPI dependency for workspace-scoped queries with RLS context applied."""
    async with acquire(workspace_id) as connection:
        yield connection


def require_agent_write_scope(auth: AuthContext) -> None:
    if auth.actor_type != "agent":
        return
    if auth.token_scope not in {"write", "admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Agent token scope '{auth.token_scope}' cannot perform write operations",
        )


def require_platform_admin(auth: Annotated[AuthContext, Depends(require_auth)]) -> AuthContext:
    if auth.actor_type == "human" and auth.is_platform_admin:
        return auth
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Platform admin required")


async def revoke_session(token: str, *, rotated: bool = False) -> None:
    pool = await get_db_pool()
    await pool.execute(
        """
        UPDATE sessions
        SET revoked_at = COALESCE(revoked_at, NOW()),
            rotated_at = CASE WHEN $2 THEN NOW() ELSE rotated_at END
        WHERE token_hash = $1
          AND revoked_at IS NULL
        """,
        hash_session_token(token),
        rotated,
    )


async def issue_session(response: Response, user_id: str, replaced_token: str | None = None) -> str:
    pool = await get_db_pool()
    settings = get_settings()
    token, token_hash = create_session_token()
    if replaced_token:
        await revoke_session(replaced_token, rotated=True)
    await pool.execute(
        """
        INSERT INTO sessions (user_id, token_hash, expires_at)
        VALUES ($1::uuid, $2, $3)
        """,
        user_id,
        token_hash,
        datetime.now(UTC) + SESSION_TTL,
    )
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        httponly=True,
        samesite="lax",
        secure=settings.app_env != "development",
        max_age=int(SESSION_TTL.total_seconds()),
    )
    return token


async def register_user(email: str, password: str, display_name: str) -> str:
    pool = await get_db_pool()
    existing = await pool.fetchval("SELECT 1 FROM users WHERE email = $1", email)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    row = await pool.fetchrow(
        """
        INSERT INTO users (email, password_hash, display_name)
        VALUES ($1, $2, $3)
        RETURNING id::text AS id
        """,
        email,
        hash_password(password),
        display_name,
    )
    return row["id"]


async def authenticate_user(email: str, password: str) -> str:
    pool = await get_db_pool()
    row = await pool.fetchrow(
        "SELECT id::text AS id, password_hash FROM users WHERE email = $1",
        email,
    )
    if not row or not verify_password(password, row["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return row["id"]


async def create_workspace_agent_token(workspace_id: str, created_by: str, name: str, scope: str = "write", expires_in_days: int = 90) -> dict[str, str]:
    token, token_hash, token_prefix = generate_agent_token()
    expires_at = datetime.now(UTC) + timedelta(days=expires_in_days)
    async with acquire(workspace_id) as connection:
        row = await connection.fetchrow(
            """
            INSERT INTO agent_tokens (workspace_id, name, token_hash, token_prefix, scope, created_by, expires_at)
            VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7)
            RETURNING id::text AS id, token_prefix, scope, expires_at
            """,
            workspace_id,
            name,
            token_hash,
            token_prefix,
            scope,
            created_by,
            expires_at,
        )
    return {"id": row["id"], "token": token, "token_prefix": row["token_prefix"], "scope": row["scope"], "expires_at": str(row["expires_at"])}

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import Cookie, Depends, Header, HTTPException, Request, Response, status

from llm_wiki_core.db import get_db_pool
from llm_wiki_core.security import (
    AuthContext,
    create_session_token,
    decode_session_token,
    generate_agent_token,
    hash_agent_token,
    hash_password,
    verify_password,
)


SESSION_COOKIE = "llm_wiki_session"
VALID_AGENT_SCOPES = {"read", "write", "admin"}


async def require_auth(
    request: Request,
    session_cookie: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> AuthContext:
    pool = await get_db_pool()
    token = session_cookie

    if authorization and authorization.startswith("Bearer "):
        raw = authorization[7:]
        if raw.startswith("lwa_"):
            row = await pool.fetchrow(
                """
                SELECT workspace_id::text AS workspace_id, scope, id::text AS token_id
                FROM agent_tokens
                WHERE token_hash = $1 AND revoked_at IS NULL
                """,
                hash_agent_token(raw),
            )
            if not row:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid agent token")
            if row["scope"] not in VALID_AGENT_SCOPES:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Token has invalid scope '{row['scope']}'")
            await pool.execute(
                "UPDATE agent_tokens SET last_used_at = NOW() WHERE id = $1::uuid",
                row["token_id"],
            )
            return AuthContext(
                actor_type="agent",
                actor_id=row["token_id"],
                token_scope=row["scope"],
                workspace_roles={row["workspace_id"]: "admin"},
            )
        token = raw

    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    try:
        claims = decode_session_token(token)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session token") from exc

    user_id = claims["sub"]
    session = await pool.fetchrow(
        """
        SELECT user_id::text AS user_id
        FROM sessions
        WHERE token = $1 AND user_id = $2::uuid AND expires_at > NOW()
        """,
        token,
        user_id,
    )
    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")

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
    return AuthContext(
        actor_type="human",
        actor_id=user_id,
        user_id=user_id,
        organization_id=organization_id,
        workspace_roles=workspace_roles,
        token_scope="admin",
    )


async def require_workspace_access(
    workspace_id: str,
    auth: Annotated[AuthContext, Depends(require_auth)],
) -> AuthContext:
    if auth.actor_type == "agent" and auth.workspace_roles and workspace_id in auth.workspace_roles:
        return auth
    if auth.actor_type == "human" and auth.workspace_roles and workspace_id in auth.workspace_roles:
        return auth
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Workspace access denied")


def require_agent_write_scope(auth: AuthContext) -> None:
    if auth.actor_type != "agent":
        return
    if auth.token_scope not in {"write", "admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Agent token scope '{auth.token_scope}' cannot perform write operations",
        )


async def issue_session(response: Response, user_id: str) -> str:
    pool = await get_db_pool()
    token = create_session_token(user_id)
    await pool.execute(
        """
        INSERT INTO sessions (user_id, token, expires_at)
        VALUES ($1::uuid, $2, $3)
        """,
        user_id,
        token,
        datetime.now(UTC) + timedelta(days=7),
    )
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=60 * 60 * 24 * 7,
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


async def create_workspace_agent_token(workspace_id: str, created_by: str, name: str, scope: str = "write") -> dict[str, str]:
    pool = await get_db_pool()
    token, token_hash, token_prefix = generate_agent_token()
    row = await pool.fetchrow(
        """
        INSERT INTO agent_tokens (workspace_id, name, token_hash, token_prefix, scope, created_by)
        VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid)
        RETURNING id::text AS id, token_prefix, scope
        """,
        workspace_id,
        name,
        token_hash,
        token_prefix,
        scope,
        created_by,
    )
    return {"id": row["id"], "token": token, "token_prefix": row["token_prefix"], "scope": row["scope"]}

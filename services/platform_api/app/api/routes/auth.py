from typing import Annotated

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, EmailStr, Field

from ...core.deps import AuthContext, authenticate_user, issue_session, register_user, require_auth
from llm_wiki_core.db import get_db_pool
from ...services.workspace import bootstrap_workspace


router = APIRouter(prefix="/v1/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    display_name: str = Field(min_length=1, max_length=80)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)


@router.post("/register")
async def register(body: RegisterRequest, response: Response) -> dict:
    user_id = await register_user(body.email, body.password, body.display_name)
    pool = await get_db_pool()
    async with pool.acquire() as connection:
        async with connection.transaction():
            organization = await connection.fetchrow(
                """
                INSERT INTO organizations (name, slug)
                VALUES ($1, $2)
                RETURNING id::text AS id
                """,
                f"{body.display_name} Organization",
                f"user-{user_id[:8]}",
            )
            await connection.execute(
                """
                INSERT INTO organization_members (organization_id, user_id, role)
                VALUES ($1::uuid, $2::uuid, 'owner')
                """,
                organization["id"],
                user_id,
            )
    await bootstrap_workspace(organization["id"], "Core Vault", "Primary compiled knowledge workspace")
    token = await issue_session(response, user_id)
    return {"data": {"user_id": user_id, "session_token": token}}


@router.post("/login")
async def login(body: LoginRequest, response: Response) -> dict:
    user_id = await authenticate_user(body.email, body.password)
    token = await issue_session(response, user_id)
    return {"data": {"user_id": user_id, "session_token": token}}


@router.get("/me")
async def me(auth: Annotated[AuthContext, Depends(require_auth)]) -> dict:
    pool = await get_db_pool()
    user = await pool.fetchrow(
        "SELECT id::text AS id, email, display_name FROM users WHERE id = $1::uuid",
        auth.user_id,
    )
    return {"data": dict(user)}

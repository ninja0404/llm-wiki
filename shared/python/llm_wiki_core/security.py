from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass

import bcrypt


@dataclass(slots=True)
class AuthContext:
    actor_type: str
    actor_id: str
    user_id: str | None = None
    organization_id: str | None = None
    workspace_roles: dict[str, str] | None = None
    token_scope: str = "admin"
    is_platform_admin: bool = False


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session_token() -> tuple[str, str]:
    token = f"lws_{secrets.token_urlsafe(48)}"
    return token, _hash_token(token)


def hash_session_token(token: str) -> str:
    return _hash_token(token)


def generate_agent_token() -> tuple[str, str, str]:
    raw = secrets.token_urlsafe(48)
    token = f"lwa_{raw}"
    token_hash = _hash_token(token)
    return token, token_hash, token[:12]


def hash_agent_token(token: str) -> str:
    return _hash_token(token)

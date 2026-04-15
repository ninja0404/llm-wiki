from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
import jwt

from .config import get_settings


@dataclass(slots=True)
class AuthContext:
    actor_type: str
    actor_id: str
    user_id: str | None = None
    organization_id: str | None = None
    workspace_roles: dict[str, str] | None = None
    token_scope: str = "admin"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_session_token(user_id: str) -> str:
    settings = get_settings()
    payload = {
        "sub": user_id,
        "exp": datetime.now(UTC) + timedelta(days=7),
        "kind": "session",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_session_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])


def generate_agent_token() -> tuple[str, str, str]:
    raw = secrets.token_urlsafe(36)
    token = f"lwa_{raw}"
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return token, token_hash, token[:12]


def hash_agent_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

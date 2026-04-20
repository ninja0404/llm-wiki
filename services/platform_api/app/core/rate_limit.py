from __future__ import annotations

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from llm_wiki_core.config import get_settings


def _key_by_user_or_ip(request: Request) -> str:
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer lwa_"):
        return f"token:{auth_header[7:19]}"
    cookie = request.cookies.get("llm_wiki_session")
    if cookie:
        return f"session:{cookie[:16]}"
    return f"ip:{get_remote_address(request)}"


limiter = Limiter(
    key_func=_key_by_user_or_ip,
    storage_uri=get_settings().redis_url,
    default_limits=["120/minute"],
)

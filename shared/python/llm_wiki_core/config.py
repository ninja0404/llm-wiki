from urllib.parse import urlparse

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    app_url: str = "http://localhost:3000"
    api_url: str = "http://localhost:8000"
    mcp_url: str = "http://localhost:8080/mcp"
    converter_url: str = "http://localhost:8090"

    database_url: str = "postgresql://llmwiki:llmwiki@localhost:5432/llmwiki"
    redis_url: str = "redis://localhost:6379/0"

    minio_endpoint: str = "localhost:9000"
    minio_use_ssl: bool = False
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "llmwiki"

    jwt_secret: str = Field(default="dev-jwt-secret-change-me-please", min_length=16)
    agent_token_secret: str = Field(default="dev-agent-secret-change-me", min_length=16)

    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    embedding_dimensions: int = 1024

    embedding_api_key: str | None = None
    embedding_base_url: str | None = None

    # Seed values for workspace_settings initialization only — NOT used at runtime
    seed_llm_provider: str = "openai"
    seed_llm_model: str = "gpt-4.1-mini"
    seed_embedding_provider: str = "openai"
    seed_embedding_model: str = "text-embedding-3-small"

    worker_poll_interval_ms: int = 1500


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    if settings.minio_endpoint.startswith("http://") or settings.minio_endpoint.startswith("https://"):
        parsed = urlparse(settings.minio_endpoint)
        settings.minio_endpoint = parsed.netloc
        settings.minio_use_ssl = parsed.scheme == "https"
    return settings

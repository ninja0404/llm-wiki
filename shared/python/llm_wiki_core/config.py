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

    database_url: str
    redis_url: str

    minio_endpoint: str
    minio_use_ssl: bool = False
    minio_access_key: str
    minio_secret_key: str
    minio_bucket: str

    internal_service_token: str = Field(min_length=32)
    active_key_version: str = Field(min_length=1)
    keyring_json: str = Field(min_length=2)

    embedding_dimensions: int = 1024
    worker_poll_interval_ms: int = 1500


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    if settings.minio_endpoint.startswith("http://") or settings.minio_endpoint.startswith("https://"):
        parsed = urlparse(settings.minio_endpoint)
        settings.minio_endpoint = parsed.netloc
        settings.minio_use_ssl = parsed.scheme == "https"
    if settings.app_env != "development" and not settings.app_url.startswith("https://"):
        raise RuntimeError("Non-development deployments must use HTTPS APP_URL")
    return settings

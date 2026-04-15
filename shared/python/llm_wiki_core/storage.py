from __future__ import annotations

from io import BytesIO

from minio import Minio

from .config import get_settings


_client: Minio | None = None


def get_storage_client() -> Minio:
    global _client
    if _client is None:
        settings = get_settings()
        _client = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_use_ssl,
        )
        found = _client.bucket_exists(settings.minio_bucket)
        if not found:
            _client.make_bucket(settings.minio_bucket)
    return _client


def put_bytes(key: str, data: bytes, content_type: str) -> None:
    client = get_storage_client()
    client.put_object(
        bucket_name=get_settings().minio_bucket,
        object_name=key,
        data=BytesIO(data),
        length=len(data),
        content_type=content_type,
    )


def get_bytes(key: str) -> bytes:
    client = get_storage_client()
    response = client.get_object(get_settings().minio_bucket, key)
    try:
        return response.read()
    finally:
        response.close()
        response.release_conn()

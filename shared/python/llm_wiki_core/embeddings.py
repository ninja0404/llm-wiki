from __future__ import annotations

import logging
import math
from dataclasses import dataclass

import httpx

from .metrics import EMBEDDING_CALLS_TOTAL, EMBEDDING_DURATION
from .tracing import traced_span

logger = logging.getLogger(__name__)

_http_client: httpx.AsyncClient | None = None


@dataclass(slots=True)
class EmbeddingConfig:
    api_key: str
    base_url: str
    model: str
    dimensions: int = 1024


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(timeout=30.0)
    return _http_client


async def generate_embedding(text: str, config: EmbeddingConfig) -> list[float]:
    """Generate embedding via configured API. Config is required — no fallback to env."""
    if not config.api_key or not config.base_url:
        raise RuntimeError(
            f"Embedding API not configured: api_key and base_url are required (model={config.model})"
        )
    return await _api_embedding(config.base_url, config.api_key, config.model, text, config.dimensions)


async def _api_embedding(
    base_url: str,
    api_key: str,
    model: str,
    text: str,
    dimensions: int,
) -> list[float]:
    import time

    url = f"{base_url.rstrip('/')}/embeddings"
    client = _get_http_client()
    body: dict = {
        "model": model,
        "input": text[:8000],
    }
    if "bge" not in model.lower():
        body["dimensions"] = dimensions

    start = time.perf_counter()
    try:
        with traced_span(
            "embedding.invoke",
            tracer_name="embedding",
            attributes={"embedding.model": model, "embedding.dimensions": dimensions},
        ):
            response = await client.post(
                url,
                json=body,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            )
            response.raise_for_status()
            data = response.json()
            vector: list[float] = data["data"][0]["embedding"]
        EMBEDDING_CALLS_TOTAL.labels(model=model, status="succeeded").inc()
        EMBEDDING_DURATION.labels(model=model).observe(time.perf_counter() - start)
    except Exception:
        EMBEDDING_CALLS_TOTAL.labels(model=model, status="failed").inc()
        EMBEDDING_DURATION.labels(model=model).observe(time.perf_counter() - start)
        raise

    if len(vector) > dimensions:
        vector = vector[:dimensions]
    elif len(vector) < dimensions:
        vector.extend([0.0] * (dimensions - len(vector)))

    norm = math.sqrt(sum(v * v for v in vector)) or 1.0
    return [v / norm for v in vector]

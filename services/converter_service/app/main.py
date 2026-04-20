from __future__ import annotations

import asyncio
import subprocess
import tempfile
from pathlib import Path
from uuid import uuid4

import structlog
from fastapi import FastAPI, Header, Request, Response, HTTPException, status
from pydantic import BaseModel

from llm_wiki_core.config import get_settings
from llm_wiki_core.logging import configure_logging
from llm_wiki_core.metrics import ACTIVE_REQUESTS, CONVERTER_CALLS_TOTAL, CONVERTER_DURATION, CONVERTER_SOURCE_BYTES, REQUEST_COUNT, REQUEST_LATENCY, make_metrics_response
from llm_wiki_core.storage import get_bytes, put_bytes
from llm_wiki_core.tracing import configure_tracing

configure_logging(json_output=True)
configure_tracing(service_name="converter-service")
logger = structlog.get_logger()
settings = get_settings()

app = FastAPI(title="LLM Wiki Converter Service", version="0.1.0")

try:
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    FastAPIInstrumentor.instrument_app(app)
except ImportError:
    pass

ALLOWED_EXTENSIONS = {"docx", "doc", "pptx", "ppt", "odt", "odp"}
MAX_SOURCE_BYTES = 200 * 1024 * 1024  # 200 MiB — hard cap on source object size


class ConvertRequest(BaseModel):
    source_object_key: str
    target_object_key: str
    source_ext: str


def _read_source_object(object_key: str) -> bytes:
    source_bytes = get_bytes(object_key)
    if len(source_bytes) > MAX_SOURCE_BYTES:
        raise HTTPException(status_code=413, detail="Source exceeds size limit")
    return source_bytes


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/metrics", include_in_schema=False)
async def metrics_endpoint() -> Response:
    return Response(content=make_metrics_response(), media_type="text/plain; version=0.0.4; charset=utf-8")


@app.middleware("http")
async def observability_middleware(request: Request, call_next):
    import time

    request_id = request.headers.get("X-Request-ID", str(uuid4()))
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(request_id=request_id, method=request.method, path=request.url.path)

    ACTIVE_REQUESTS.inc()
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        REQUEST_COUNT.labels(method=request.method, path_template=request.url.path, status_code="500").inc()
        REQUEST_LATENCY.labels(method=request.method, path_template=request.url.path).observe(time.perf_counter() - start)
        ACTIVE_REQUESTS.dec()
        raise
    elapsed = time.perf_counter() - start
    REQUEST_COUNT.labels(method=request.method, path_template=request.url.path, status_code=str(response.status_code)).inc()
    REQUEST_LATENCY.labels(method=request.method, path_template=request.url.path).observe(elapsed)
    ACTIVE_REQUESTS.dec()
    response.headers["X-Request-ID"] = request_id
    return response


@app.post("/convert")
async def convert(request: ConvertRequest, authorization: str | None = Header(default=None)) -> dict:
    if authorization != f"Bearer {settings.internal_service_token}":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal service token")
    if request.source_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported source extension")

    import time

    start = time.perf_counter()
    with tempfile.TemporaryDirectory() as temp_dir:
        source_path = Path(temp_dir) / f"source.{request.source_ext}"
        source_bytes = await asyncio.to_thread(_read_source_object, request.source_object_key)
        CONVERTER_SOURCE_BYTES.labels(source_ext=request.source_ext).observe(len(source_bytes))
        await asyncio.to_thread(source_path.write_bytes, source_bytes)

        result = await asyncio.to_thread(
            subprocess.run,
            [
                "libreoffice",
                "--headless",
                "--norestore",
                "--convert-to",
                "pdf",
                "--outdir",
                temp_dir,
                str(source_path),
            ],
            capture_output=True,
            timeout=120,
            check=False,
        )
        if result.returncode != 0:
            # stderr may include /tmp paths and internal diagnostics — keep it in logs only.
            logger.error(
                "LibreOffice conversion failed rc=%s stderr=%s",
                result.returncode,
                result.stderr.decode("utf-8", errors="replace")[:2000],
            )
            CONVERTER_CALLS_TOTAL.labels(source_ext=request.source_ext, status="failed").inc()
            CONVERTER_DURATION.labels(source_ext=request.source_ext).observe(time.perf_counter() - start)
            raise HTTPException(status_code=500, detail="Conversion failed")

        pdf_path = Path(temp_dir) / "source.pdf"
        if not pdf_path.exists():
            CONVERTER_CALLS_TOTAL.labels(source_ext=request.source_ext, status="failed").inc()
            CONVERTER_DURATION.labels(source_ext=request.source_ext).observe(time.perf_counter() - start)
            raise HTTPException(status_code=500, detail="Conversion produced no output")

        pdf_bytes = await asyncio.to_thread(pdf_path.read_bytes)
        await asyncio.to_thread(put_bytes, request.target_object_key, pdf_bytes, "application/pdf")

    CONVERTER_CALLS_TOTAL.labels(source_ext=request.source_ext, status="succeeded").inc()
    CONVERTER_DURATION.labels(source_ext=request.source_ext).observe(time.perf_counter() - start)
    return {"status": "ok"}

from contextlib import asynccontextmanager
from uuid import uuid4

import structlog
from fastapi import FastAPI, Request, Response
from mcp.server.fastmcp import FastMCP

from llm_wiki_core.db import close_db_pool, init_db_pool
from llm_wiki_core.logging import configure_logging
from llm_wiki_core.metrics import ACTIVE_REQUESTS, REQUEST_COUNT, REQUEST_LATENCY, make_metrics_response
from llm_wiki_core.queue import close_redis
from llm_wiki_core.tracing import configure_tracing

from .tools import register_tools


configure_logging(json_output=True)
configure_tracing(service_name="mcp-service")
logger = structlog.get_logger()

mcp = FastMCP("LLM Wiki MCP", instructions="Use workspace_id + agent_token to operate the knowledge vault.")
mcp.settings.transport_security.enable_dns_rebinding_protection = True
mcp.settings.transport_security.allowed_hosts = [
    "localhost",
    "localhost:*",
    "127.0.0.1",
    "127.0.0.1:*",
    "testserver",
    "testserver:*",
]
register_tools(mcp)
mcp_app = mcp.streamable_http_app()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db_pool()
    try:
        yield
    finally:
        await close_db_pool()
        await close_redis()


app = FastAPI(title="LLM Wiki MCP Gateway", version="0.1.0", lifespan=lifespan)

try:
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    FastAPIInstrumentor.instrument_app(app)
except ImportError:
    pass


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
    structlog.contextvars.bind_contextvars(
        request_id=request_id,
        method=request.method,
        path=request.url.path,
    )

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


app.mount("/", mcp_app)

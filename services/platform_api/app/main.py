from contextlib import asynccontextmanager
from uuid import uuid4

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded

from llm_wiki_core.config import get_settings
from llm_wiki_core.db import close_db_pool, init_db_pool
from llm_wiki_core.logging import configure_logging
from llm_wiki_core.metrics import ACTIVE_REQUESTS, REQUEST_COUNT, REQUEST_LATENCY, make_metrics_response
from llm_wiki_core.queue import close_redis
from llm_wiki_core.tracing import configure_tracing

from .core.rate_limit import limiter
from .api.routes import activity, agent_tokens, auth, documents, exports, graph, health, revisions, runs, search, settings, workspaces


configure_logging(json_output=True)
configure_tracing(service_name="platform-api")
logger = structlog.get_logger()

settings_obj = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db_pool()
    try:
        yield
    finally:
        await close_db_pool()
        await close_redis()


app = FastAPI(title="LLM Wiki vNext Platform API", version="0.1.0", lifespan=lifespan)
app.state.limiter = limiter

try:
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    FastAPIInstrumentor.instrument_app(app)
except ImportError:
    pass


async def _rate_limit_handler(request: Request, exc: RateLimitExceeded) -> Response:
    return Response(
        content='{"detail":"Rate limit exceeded. Try again later."}',
        status_code=429,
        media_type="application/json",
        headers={"Retry-After": exc.detail.split()[-1] if exc.detail else "60"},
    )


app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)

@app.get("/metrics", include_in_schema=False)
async def metrics_endpoint():
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

    path_template = request.url.path
    for route in app.routes:
        if hasattr(route, "path") and hasattr(route, "matches"):
            match, _ = route.matches(request.scope)
            if match.value >= 1:
                path_template = route.path
                break

    ACTIVE_REQUESTS.inc()
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        REQUEST_COUNT.labels(method=request.method, path_template=path_template, status_code="500").inc()
        REQUEST_LATENCY.labels(method=request.method, path_template=path_template).observe(time.perf_counter() - start)
        ACTIVE_REQUESTS.dec()
        raise
    elapsed = time.perf_counter() - start
    REQUEST_COUNT.labels(method=request.method, path_template=path_template, status_code=str(response.status_code)).inc()
    REQUEST_LATENCY.labels(method=request.method, path_template=path_template).observe(elapsed)
    ACTIVE_REQUESTS.dec()
    response.headers["X-Request-ID"] = request_id
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings_obj.app_url, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(health.router)
app.include_router(auth.router)
app.include_router(workspaces.router)
app.include_router(documents.router)
app.include_router(revisions.router)
app.include_router(runs.router)
app.include_router(activity.router)
app.include_router(search.router)
app.include_router(settings.router)
app.include_router(agent_tokens.router)
app.include_router(exports.router)
app.include_router(graph.router)

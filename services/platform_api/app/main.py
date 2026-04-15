from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from llm_wiki_core.config import get_settings
from llm_wiki_core.db import close_db_pool, init_db_pool
from llm_wiki_core.queue import close_redis

from .api.routes import activity, agent_tokens, auth, documents, exports, graph, health, revisions, runs, search, settings, workspaces


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

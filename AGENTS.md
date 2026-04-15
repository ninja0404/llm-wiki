# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Project Overview

LLM Wiki — Agent-native compiled knowledge vault for enterprise teams. Upload raw documents (PDF, DOCX, XLSX, CSV, Markdown, HTML), LLM automatically extracts entities, claims, and relations to build an interlinked Wiki knowledge base with hybrid search, interactive graph visualization, and an MCP-compatible agent interface.

## Commands

```bash
# Infrastructure
docker compose up -d          # Start PostgreSQL + Redis + MinIO
docker compose down           # Stop services

# Development (all services)
python3 scripts/check_local_stack.py   # Verify infrastructure readiness
python3 scripts/init_local_db.py       # Initialize database schema
pip install -e ".[dev]"                # Install Python dependencies
cd web && bun install && cd ..         # Install frontend dependencies
python3 scripts/dev_stack.py           # Start all 5 services concurrently

# Individual services
uvicorn services.platform_api.app.main:app --reload --host 0.0.0.0 --port 8000   # Platform API
python -m services.compiler_worker.app.main                                        # Compiler Worker
uvicorn services.mcp_service.app.main:app --reload --host 0.0.0.0 --port 8080    # MCP Service
uvicorn services.converter_service.app.main:app --reload --host 0.0.0.0 --port 8090  # Converter
cd web && bun dev                      # Frontend dev server

# Testing
pytest tests/unit tests/integration    # Run all tests
ruff check .                           # Lint Python code

# Frontend
cd web && bun dev              # Dev server (http://localhost:3000)
cd web && bun run build        # Production build
cd web && bun run lint         # TypeScript check
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11+ / FastAPI / asyncpg |
| Database | PostgreSQL + pgvector + pgroonga + pg_trgm |
| Storage | MinIO (S3-compatible) |
| Queue | Redis (List-based RPUSH/BLPOP) |
| LLM | OpenAI / Anthropic / DeepSeek / SiliconFlow (configurable per workspace) |
| Embedding | Configurable per workspace (1024-dim vectors) |
| Frontend | Next.js 15 / React 19 / Tailwind CSS v4 / next-intl |
| MCP | FastMCP (Streamable HTTP) |
| Package Manager | pip (Python) / bun (Frontend) |
| Docker | docker compose (never docker-compose) |

## Architecture

### Service Architecture (5 Microservices)

| Service | Port | Entry Point | Purpose |
|---------|------|-------------|---------|
| platform-api | 8000 | `services/platform_api/app/main.py` | FastAPI REST API server |
| compiler-worker | — | `services/compiler_worker/app/main.py` | Redis queue consumer, document parsing + LLM extraction + embedding |
| mcp-service | 8080 | `services/mcp_service/app/main.py` | FastMCP Streamable HTTP, agent interface |
| converter-service | 8090 | `services/converter_service/app/main.py` | LibreOffice-based document conversion (DOCX/PPTX → PDF) |
| web | 3000 | `web/` | Next.js 15 frontend with App Router |

### Directory Structure

```
llm-wiki/
├── services/
│   ├── platform_api/app/          # FastAPI main API
│   │   ├── main.py                # App factory + CORS + router registration
│   │   ├── core/deps.py           # Dependency injection (auth, workspace scoping)
│   │   └── api/routes/            # 12 route modules (auth, workspaces, documents, ...)
│   ├── compiler_worker/app/       # Compiler Worker
│   │   ├── main.py                # Redis queue polling loop
│   │   └── pipeline/runner.py     # Full ingest pipeline
│   ├── mcp_service/app/           # MCP Agent Interface
│   │   ├── main.py                # FastMCP app
│   │   └── tools/                 # MCP tools (search, read, write, delete, lint, guide)
│   └── converter_service/app/     # Document Converter
│       └── main.py                # LibreOffice PDF conversion
├── shared/python/llm_wiki_core/   # Shared Python core library
│   ├── config.py                  # pydantic-settings configuration
│   ├── db.py                      # asyncpg connection pool
│   ├── queue.py                   # Redis queue operations
│   ├── llm.py                     # LLM invocation (OpenAI-compatible + Anthropic)
│   ├── embeddings.py              # Embedding generation via HTTP API
│   ├── parsing.py                 # Document parsing (PDF, DOCX, XLSX, CSV, MD, HTML)
│   ├── security.py                # JWT, bcrypt, agent token generation
│   ├── storage.py                 # MinIO object storage
│   ├── audit.py                   # Activity event logging
│   ├── change_plan.py             # Change plan data structure
│   ├── diffing.py                 # Content diff utilities
│   └── markdown_ops.py            # Markdown manipulation
├── web/                           # Next.js 15 frontend (App Router)
├── db/migrations/                 # SQL migration files
├── scripts/                       # Development utilities
├── tests/                         # Test suite
├── docker-compose.yml             # Dev infrastructure
└── pyproject.toml                 # Python project config
```

### Multi-Tenancy Model

- **Users** → **Organizations** (via **Organization Members**, roles: owner/admin/editor/viewer) → **Workspaces**
- Each workspace is an isolated knowledge base with its own LLM/embedding configuration
- All workspace-scoped API routes enforce organization membership

### Data Flow: Source Ingestion Pipeline

```
Upload file → MinIO storage → document record (status=draft)
 → Run created (type=ingest) → Redis queue (RPUSH)
 → Compiler Worker (BLPOP) → parse → split blocks → generate embeddings
 → LLM extract entities/claims/relations → write to DB
 → Build change plan → create wiki documents → publish event
```

### Data Flow: Hybrid Search

```
Query → pgroonga full-text + pgvector semantic + graph connectivity boost → RRF merge → ranked results
```

### Database Schema (16 Core Tables)

users, sessions, organizations, organization_members, workspaces, workspace_settings, agent_tokens, documents, document_revisions, document_pages, document_blocks (with vector embedding), entities, claims, relations, citations, document_references, runs, run_steps, activity_events.

PostgreSQL extensions: `pgvector`, `pgroonga`, `pg_trgm`, `pgcrypto`.

### MCP Agent Interface

- **Endpoint**: `http://localhost:8080/mcp`
- **Auth**: Agent token (`lwa_xxx`)
- **Tools**: search, read, write, delete, lint, guide
- **Scopes**: read / write / admin

### Frontend Pages

| Route | Page |
|-------|------|
| `/` | Dashboard |
| `/vault` | Wiki document viewer (+ `/vault/[documentId]`) |
| `/sources` | Source file management + upload |
| `/graph` | Knowledge graph visualization (force-directed) |
| `/search` | Hybrid search |
| `/runs` | Compiler run logs (+ `/runs/[runId]`) |
| `/revisions` | Document revisions (+ `/revisions/[revisionId]`) |
| `/activity` | Activity event log |
| `/settings` | Workspace settings (LLM/embedding config) |
| `/login` | Login page |

## Environment Variables

See `.env.example`. LLM/embedding provider/model/key is configured per-workspace in Settings page, not via env.

Required: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `AGENT_TOKEN_SECRET`

## Important Conventions

- **Package manager**: pip for Python, bun for frontend. Never use npm.
- **Docker**: Always `docker compose`, never `docker-compose`
- **Database**: Raw asyncpg queries with `$1::uuid` casting — no ORM
- **JSON**: `orjson` for serialization
- **Auth**: JWT via `PyJWT`, passwords via `bcrypt`, agent tokens SHA-256 hashed with `lwa_` prefix
- **Embedding**: 1024-dim vectors, L2-normalized
- **Per-workspace config**: LLM/embedding settings stored in `workspace_settings` table, not env vars
- **PYTHONPATH**: Must include project root + `shared/python/`

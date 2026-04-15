# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│  Next.js 15  │────▶│ Platform API │────▶│  PostgreSQL   │
│   :3000      │     │   :8000      │     │  pgvector     │
└─────────────┘     └──────┬───────┘     │  pgroonga     │
                           │              └───────────────┘
                    ┌──────┴───────┐
                    │   Compiler   │     ┌───────────────┐
                    │   Worker     │────▶│    MinIO       │
                    └──────────────┘     └───────────────┘
                    ┌──────────────┐     ┌───────────────┐
                    │ MCP Service  │     │    Redis       │
                    │   :8080      │     └───────────────┘
                    └──────────────┘
                    ┌──────────────┐
                    │  Converter   │
                    │   :8090      │
                    └──────────────┘
```

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
│   │   ├── api/routes/            # Route handlers (12 modules)
│   │   │   ├── auth.py            # Register / Login / Session
│   │   │   ├── workspaces.py      # Workspace CRUD
│   │   │   ├── documents.py       # Document CRUD + file upload + ingest trigger
│   │   │   ├── revisions.py       # Document revision history
│   │   │   ├── search.py          # Hybrid search (pgroonga + pgvector + graph boost)
│   │   │   ├── graph.py           # Knowledge graph data API
│   │   │   ├── runs.py            # Compiler run status
│   │   │   ├── activity.py        # Activity event log
│   │   │   ├── settings.py        # Workspace settings (LLM/embedding config)
│   │   │   ├── agent_tokens.py    # Agent token CRUD
│   │   │   ├── exports.py         # Document export
│   │   │   └── health.py          # Health check
│   │   └── services/workspace.py  # Workspace creation logic
│   ├── compiler_worker/app/       # Compiler Worker
│   │   ├── main.py                # Redis queue polling loop
│   │   └── pipeline/runner.py     # Full ingest pipeline (parse → extract → embed → compile)
│   ├── mcp_service/app/           # MCP Agent Interface
│   │   ├── main.py                # FastMCP app
│   │   ├── core/auth.py           # Agent token auth
│   │   └── tools/                 # MCP tools (search, read, write, delete, lint, guide)
│   └── converter_service/app/     # Document Converter
│       └── main.py                # LibreOffice PDF conversion
├── shared/python/llm_wiki_core/   # Shared Python core library
│   ├── config.py                  # pydantic-settings configuration
│   ├── db.py                      # asyncpg connection pool
│   ├── queue.py                   # Redis queue (enqueue_run / pop_run / publish_event)
│   ├── llm.py                     # LLM invocation (OpenAI-compatible + Anthropic)
│   ├── embeddings.py              # Embedding generation via HTTP API
│   ├── parsing.py                 # Document parsing (PDF, DOCX, XLSX, CSV, MD, HTML)
│   ├── security.py                # JWT, bcrypt password hashing, agent token generation
│   ├── storage.py                 # MinIO object storage
│   ├── audit.py                   # Activity event logging
│   ├── change_plan.py             # Change plan data structure
│   ├── diffing.py                 # Content diff utilities
│   └── markdown_ops.py            # Markdown manipulation
├── web/                           # Next.js 15 frontend
│   ├── app/                       # App Router pages
│   │   ├── (app)/                 # Protected route group
│   │   │   ├── vault/             # Wiki document viewer
│   │   │   ├── sources/           # Source file management
│   │   │   ├── graph/             # Knowledge graph visualization
│   │   │   ├── search/            # Hybrid search
│   │   │   ├── runs/              # Compiler run logs
│   │   │   ├── revisions/         # Document revisions
│   │   │   ├── activity/          # Activity log
│   │   │   └── settings/          # Workspace settings
│   │   └── login/                 # Login page
│   ├── components/                # React components
│   ├── lib/                       # API client, utilities
│   ├── i18n/                      # Internationalization config
│   └── messages/                  # i18n translation files
├── db/migrations/                 # SQL migration files
│   └── 001_vnext_schema.sql       # Full schema DDL
├── scripts/                       # Development utilities
│   ├── dev_stack.py               # Start all services concurrently
│   ├── check_local_stack.py       # Verify infrastructure
│   └── init_local_db.py           # Initialize database
├── tests/                         # Test suite
├── docker-compose.yml             # Dev infrastructure
├── docker-compose.prod.yml        # Production deployment
└── pyproject.toml                 # Python project config
```

### Multi-Tenancy Model

- **Users** belong to **Organizations** via **Organization Members** (roles: owner, admin, editor, viewer)
- **Organizations** own **Workspaces** — each workspace is an isolated knowledge base
- All workspace-scoped API routes enforce organization membership via dependency injection
- LLM/embedding configuration is stored per-workspace in `workspace_settings` table

### Data Flow: Source Ingestion Pipeline

```
User uploads file via Documents API
 → File stored in MinIO, document record created (status=draft)
 → Run created (type=ingest, status=queued)
 → Run ID pushed to Redis queue (RPUSH llm-wiki:runs)
 → Compiler Worker polls queue (BLPOP)
 → Pipeline: parse document → split blocks → generate embeddings → LLM extract entities/claims/relations
 → Write to DB: document_pages, document_blocks (with vectors), entities, claims, relations, citations
 → Build change plan → create/update wiki documents with revisions
 → Publish real-time event via Redis Pub/Sub
```

### Data Flow: Hybrid Search

```
User query → Platform API /search endpoint
 → pgroonga full-text search on document_blocks.text + claims.canonical_text
 → pgvector semantic search on document_blocks.embedding (cosine similarity)
 → Knowledge graph connectivity boost
 → RRF (Reciprocal Rank Fusion) merge
 → Return ranked results with snippets and citations
```

### Database Schema (16 Core Tables)

| Table | Purpose |
|-------|---------|
| `users` | User accounts (email + bcrypt password) |
| `sessions` | JWT session tokens |
| `organizations` | Tenant organizations |
| `organization_members` | User ↔ Organization membership (role-based) |
| `workspaces` | Isolated knowledge bases within organizations |
| `workspace_settings` | Per-workspace LLM/embedding/compiler/search config |
| `agent_tokens` | MCP agent access tokens (SHA-256 hashed) |
| `documents` | Source documents + Wiki pages (kind: source/wiki/system/asset) |
| `document_revisions` | Immutable revision history for documents |
| `document_pages` | Parsed pages from source documents |
| `document_blocks` | Text blocks with pgvector embeddings (1024-dim) |
| `entities` | Extracted entities (person, company, concept, etc.) |
| `claims` | Factual claims linked to entities |
| `relations` | Entity-to-entity relationships |
| `citations` | Claim ↔ source document block citations |
| `document_references` | Document-to-document links (compiled_from, etc.) |
| `runs` | Compiler run tracking (queued → running → succeeded/failed) |
| `run_steps` | Individual pipeline step records |
| `activity_events` | Audit trail for all workspace events |

Key PostgreSQL extensions: `pgvector` (vector similarity), `pgroonga` (full-text search), `pg_trgm` (trigram fuzzy matching), `pgcrypto` (UUID generation).

### MCP Agent Interface

AI agents connect via the Model Context Protocol:
- **Endpoint**: `http://localhost:8080/mcp`
- **Auth**: Agent token (`lwa_xxx`) via workspace-scoped tokens
- **Tools**: search, read, write (create/replace/append), delete, lint, guide
- **Scopes**: read / write / admin

### Key Design Decisions

- **Per-workspace configuration**: LLM provider, model, API key, embedding config, compiler rules, and search rules are all stored per-workspace in the database — NOT in environment variables
- **Redis List queue**: Simple RPUSH/BLPOP pattern instead of BullMQ/Celery for job queue
- **Raw SQL via asyncpg**: No ORM — all database operations use parameterized SQL queries directly
- **Embedding normalization**: All embeddings are L2-normalized to unit vectors after generation
- **Idempotent entity upsert**: Entities are upserted by (workspace_id, slug) with longer-wins logic for title/summary

## Environment Variables

See `.env.example`. Only infrastructure connection details are configured via env. LLM/embedding provider/model/key selection is done per-workspace in the Settings page.

Required: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `AGENT_TOKEN_SECRET`
Optional: `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `EMBEDDING_DIMENSIONS`

## Important Conventions

- **Package manager**: pip for Python, bun for frontend
- **Docker**: Always `docker compose`, never `docker-compose`
- **Python path**: Services import shared code via `llm_wiki_core` package (installed via `pip install -e .`)
- **PYTHONPATH**: Must include both project root and `shared/python/` (handled by `dev_stack.py`)
- **Database**: Raw asyncpg queries with `$1::uuid` parameter casting — no ORM
- **JSON serialization**: `orjson` for high-performance JSON encoding/decoding
- **Auth**: JWT tokens via `PyJWT`, passwords via `bcrypt`
- **Agent tokens**: Prefixed with `lwa_`, stored as SHA-256 hash
- **Embedding dimensions**: Fixed at 1024 (configurable via `EMBEDDING_DIMENSIONS` env)
- **Frontend i18n**: next-intl with translation files in `web/messages/`

# LLM Wiki

Agent-native compiled knowledge vault for enterprise teams.

Upload raw documents — LLM automatically extracts entities, claims, and relations to build an interlinked Wiki knowledge base with hybrid search, interactive graph visualization, and an MCP-compatible agent interface.

[中文文档](./README.zh-CN.md)

## Architecture

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

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11+ / FastAPI / asyncpg |
| Database | PostgreSQL 18 + pgvector + pgroonga |
| Storage | MinIO (S3-compatible) |
| Queue | Redis Streams + Consumer Groups |
| LLM | OpenAI / Anthropic / DeepSeek / SiliconFlow (configurable per workspace) |
| Embedding | Configurable per workspace (1024-dim vectors) |
| Frontend | Next.js 15 / React 19 / Tailwind CSS v4 / shadcn/ui |
| MCP | FastMCP (Streamable HTTP) |

## Quick Start

```bash
# 1. Start infrastructure
docker compose up -d postgres redis minio

# 2. Check dependencies
python3 scripts/check_local_stack.py

# 3. Initialize database
python3 scripts/init_local_db.py --reset

# 4. Install Python dependencies
pip install -e ".[dev]"

# 5. Install frontend dependencies
pnpm --dir web install

# 6. Start all services
python3 scripts/dev_stack.py
```

Open http://localhost:3000, register an account, then configure LLM/embedding providers in Settings.

## Features

### Source Ingestion
Upload PDF, DOCX, XLSX, CSV, Markdown, or HTML. The compiler worker automatically:
1. Parses documents into pages and blocks
2. Generates embeddings for semantic search
3. Extracts entities, claims, and relations via LLM
4. Creates interlinked Wiki pages with citations

### Hybrid Search
Combines pgroonga full-text search, pgvector semantic search, and knowledge graph connectivity boost. Configurable per workspace via `search_rules`.

### Knowledge Graph
Interactive force-directed visualization of entities, claims, relations, citations, and document references. Supports filtering, focus document mode, and node inspection with drill-down.

### MCP Agent Interface
AI agents connect via the Model Context Protocol with workspace-scoped tokens:
- **Endpoint**: `http://localhost:8080/mcp`
- **Tools**: search, read, create, replace, append, delete, lint, guide
- **Scopes**: read / write / admin

### Workspace Settings
All runtime configuration (LLM provider, model, API key, embedding config, compiler rules, search rules) is stored per-workspace in the database — not in environment variables.

## Testing

```bash
pytest tests/unit tests/integration
bash scripts/run_local_checks.sh
```

## Environment Variables

See `.env.example`. Only infrastructure connection details and embedding dimensions are configured via env. Provider/model selection is done per-workspace in the Settings page.

Database schema initialization is Alembic-only. Legacy SQL patches are archived for reference and are not part of the active initialization flow.

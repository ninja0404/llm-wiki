# Architecture

## System Overview

LLM-Wiki is an AI-powered knowledge base that automatically converts unstructured text/URLs into a structured, interlinked wiki. It uses LLMs to extract entities from source material, generate wiki pages, and provide a RAG-based chat interface over the knowledge base.

## Architectural Pattern

**Dual-process monolith** with shared database:

```
┌──────────────────────┐     ┌──────────────────────┐
│   API Server (Hono)  │     │   Worker (BullMQ)     │
│  - REST API          │     │  - ingest worker      │
│  - WebSocket server  │     │  - embedding worker   │
│  - Auth middleware    │     │  - circuit breaker    │
│  - Bull Board UI     │     │  - token budgeting    │
└────────┬─────────────┘     └────────┬─────────────┘
         │                            │
         │     ┌──────────────┐       │
         ├────►│  PostgreSQL  │◄──────┤
         │     │  (pgvector)  │       │
         │     └──────────────┘       │
         │     ┌──────────────┐       │
         ├────►│    Redis     │◄──────┤
         │     │ (BullMQ/WS)  │       │
         │     └──────────────┘       │
         │     ┌──────────────┐       │
         └────►│    MinIO     │◄──────┘
               │  (S3 files)  │
               └──────────────┘
```

## Multi-Tenancy Model

**Organization → Workspace** hierarchy:

- **Users** belong to **Organizations** via **Members** (roles: owner, admin, editor, viewer)
- **Organizations** own **Workspaces** — each workspace is an isolated knowledge base
- All workspace-scoped API routes enforce organization membership via middleware (`api/src/server.ts` lines 146-163)
- Token budgets tracked per-workspace per-month via Redis

## Data Flow: Source Ingestion Pipeline

```
User uploads text/URL
    │
    ▼
POST /api/workspaces/:id/sources
    │ Creates source record (status: pending)
    │ Validates URL via SSRF guard (if URL type)
    │ Fetches URL content
    │ Splits into chunks via `chunker.ts`
    │ Enqueues N extract-batch jobs
    ▼
┌─────────────────────────────────────────┐
│ Worker: extract-batch (concurrency: 3)  │
│  1. Persist source_chunks with SHA-256  │
│     content hash (dedup)                │
│  2. Generate embeddings per chunk       │
│  3. LLM structured extraction →        │
│     entities + claims (extractSchema)   │
│  4. Slugify + merge duplicate entities  │
│  5. Persist to source_extractions       │
│  6. WebSocket: ingest:progress          │
│  7. Last batch → enqueue build-wiki     │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│ Worker: build-wiki                      │
│  1. Load all extractions for source     │
│  2. Build wiki index (full or hybrid):  │
│     - Full: if index < 8K tokens       │
│     - Hybrid: pg_trgm + vector search  │
│  3. LLM wiki decisions → create/update/ │
│     flag pages (wikiDecisionSchema)     │
│  4. CAS update with lock_version       │
│  5. Create wiki_links + stub pages      │
│  6. Enqueue embedding-update if needed  │
│  7. WebSocket: wiki:page:created/updated│
│  8. Mark source: completed              │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│ Worker: embedding-update (concurrency:5)│
│  1. Load page title + summary + content │
│  2. Generate embedding via OpenAI       │
│  3. Update wiki_pages.embedding         │
└─────────────────────────────────────────┘
```

## Data Flow: Hybrid Search

```
User query → POST /api/workspaces/:id/search
    │
    ├─── Vector search (cosine similarity on pgvector)
    │     Query embedding → <=> operator → top K
    │
    ├─── Full-text search (PostgreSQL ts_rank)
    │     to_tsquery with prefix matching → top K
    │
    └─── RRF merge (Reciprocal Rank Fusion, k=60)
          Deduplicate + score fusion → final ranked results
```

## Data Flow: RAG Chat

```
User message → POST /api/workspaces/:id/chat
    │
    ├─── Query rewrite via LLM (queryRewriteSchema)
    │
    ├─── Hybrid search → relevant wiki pages
    │
    ├─── Assemble context: wiki page content as citations
    │
    └─── streamText() → SSE response with citations
```

## LLM Resilience Layer

All LLM calls go through `api/src/llm/invoke.ts` with:

1. **Circuit breaker** (`api/src/llm/circuit-breaker.ts`) — Opens after 5 failures within 10 min, delays jobs
2. **Token budgeting** (`api/src/llm/token-budget.ts`) — Monthly per-workspace limit (2M tokens default), per-ingest limit (100K tokens)
3. **Budget alerts** — WebSocket notification at 80% usage
4. **Cost tracking** — Every invocation logged to `llm_invocations` table with tokens, cost, duration
5. **Idempotent logging** — Unique index on `(sourceId, batchIndex, step)` prevents duplicate records
6. **Timeout** — 60s abort signal on all LLM calls

## Concurrency Control

- **Wiki page updates**: Optimistic Concurrency Control via `lock_version` field with CAS (Compare-And-Swap), 2 retry attempts before logging conflict
- **Tenant ingest limiting**: Redis counter `tenant:{orgId}:ingest:active` limits concurrent ingestions to 5
- **Worker concurrency**: ingest worker = 3, embedding worker = 5, with rate limiter (10 jobs/60s on ingest)

## Entry Points

- **API Server**: `api/src/server.ts` — Hono app with middleware chain
- **Worker Process**: `api/src/worker.ts` — BullMQ workers for ingest + embedding
- **Frontend**: `web/src/main.tsx` → `App.tsx` — React SPA with routing

## API Route Structure

### Public
- `GET /health` — Health check
- `POST/GET /api/auth/**` — better-auth handler

### Authenticated (session required)
- `GET /api/me` — Current user info + workspaces

### Workspace-scoped (session + org membership required)
- `/api/workspaces/:workspaceId/sources` — Source CRUD + ingest
- `/api/workspaces/:workspaceId/wiki` — Wiki page CRUD
- `/api/workspaces/:workspaceId/search` — Hybrid search
- `/api/workspaces/:workspaceId/chat` — RAG chat
- `/api/workspaces/:workspaceId/dashboard` — Usage stats
- `/api/workspaces/:workspaceId/activity` — Activity logs
- `/api/workspaces/:workspaceId/flagged` — Flagged page review

### WebSocket
- `GET /ws?workspaceId=X&token=Y` — Real-time updates channel

### Admin
- `/bull/*` — BullMQ dashboard (auth-protected)

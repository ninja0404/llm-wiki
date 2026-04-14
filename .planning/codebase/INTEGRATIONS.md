# External Integrations

## OpenAI API

- **Purpose**: Entity extraction, wiki page generation, query rewriting, embeddings
- **Provider**: `@ai-sdk/openai` via Vercel AI SDK
- **Config**: `api/src/llm/provider.ts`
- **Models used**:
  - `gpt-4o-mini` — Default for structured generation (extract, wiki-build, query-rewrite)
  - `text-embedding-3-small` — 1536-dim embeddings for vector search
- **Multi-provider support**: OpenAI, Anthropic (via base URL), custom endpoints
- **Tenant-level API key**: Encrypted with AES-256-GCM, stored per-workspace

## PostgreSQL (pgvector + pg_trgm)

- **Purpose**: Primary data store with vector search and fuzzy text matching
- **Connection**: `api/src/lib/db.ts` via `pg.Pool` → Drizzle ORM
- **Extensions**:
  - `vector` — Cosine distance search (`<=>` operator) on 1536-dim embeddings
  - `pg_trgm` — Trigram similarity (`%` operator) for entity name matching
- **Init script**: `scripts/init-db.sql` creates both extensions on database creation

## Redis

- **Purpose**: Multi-role cache and messaging layer
- **Connection**: `api/src/lib/redis.ts` via `ioredis`
- **Use cases**:
  1. **BullMQ backend** — Job queue persistence for ingest, embedding, query, lint queues
  2. **Token budget tracking** — Monthly per-workspace token counters with TTL (`budget:{workspaceId}:{period}`)
  3. **Per-ingest budget** — Token limits per source ingestion (`ingest-budget:{sourceId}`)
  4. **Circuit breaker** — LLM provider failure counting and open state (`circuit:{provider}:failures`, `circuit:{provider}:open`)
  5. **WebSocket pub/sub** — Cross-process message broadcasting (`ws:{workspaceId}` channels)
  6. **Tenant rate limiting** — Concurrent ingest counter (`tenant:{orgId}:ingest:active`)

## MinIO (S3-Compatible)

- **Purpose**: File storage for uploaded source documents
- **Config**: `api/src/lib/config.ts` — endpoint, access key, secret key, bucket name
- **Docker**: Port 9000 (API), 9001 (Console)
- **Not yet fully wired**: File upload routes reference `fileKey` field in sources schema but MinIO SDK not imported in current routes

## PgBouncer

- **Purpose**: Connection pooling proxy between app and PostgreSQL
- **Mode**: Transaction pooling
- **Config**: Docker Compose with 200 max client connections, 20 default pool size
- **Port**: 6432 (app can connect via either 5432 direct or 6432 pooled)

## WebSocket (Hono WS)

- **Purpose**: Real-time updates from server to frontend
- **Implementation**: `api/src/lib/ws.ts` — Room-based pub/sub with Redis cross-process fallback
- **Events pushed**:
  - `ingest:progress` — Source processing batch progress
  - `wiki:page:created` / `wiki:page:updated` — Wiki content changes
  - `budget:alert` — Token budget threshold warnings (80%)
  - `flagged:alert` — Flagged page count threshold (20+)
  - `worker:status` — Worker health status
  - `error` — Error notifications
- **Client**: `web/src/lib/useWs.ts` — React hook with exponential backoff reconnection

## better-auth

- **Purpose**: Authentication and multi-tenant organization management
- **Config**: `api/src/lib/auth.ts`
- **Features used**:
  - Email/password sign-up/sign-in
  - Session management with cookie tokens
  - Organization plugin — users can create organizations, manage members
  - Drizzle adapter for PostgreSQL persistence
- **Auth tables**: `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`

## Bull Board

- **Purpose**: Admin dashboard for BullMQ queue monitoring
- **Route**: `/bull` (auth-protected)
- **Adapter**: `@bull-board/hono` with `HonoAdapter`
- **Queues displayed**: ingest, query, lint, embedding-update

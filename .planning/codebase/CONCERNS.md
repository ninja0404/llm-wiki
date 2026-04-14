# Technical Concerns

## Security

### Encryption Key Default
- `api/src/lib/config.ts` line 13: `encryptionKey` defaults to `'0'.repeat(64)` — a zero-filled key
- `.env.example` also ships with `ENCRYPTION_KEY=0000...` 
- Any tenant API keys encrypted with the default key are trivially decryptable
- **Risk**: HIGH — Must enforce non-default encryption key in production

### Auth Secret Default
- `betterAuthSecret` defaults to `'dev-secret-change-in-production-use-openssl-rand-base64-32'`
- No runtime validation that the default was changed
- **Risk**: HIGH — Session tokens can be forged if default secret is used in production

### CORS Hardcoded Origin
- `api/src/server.ts` line 43: CORS origin hardcoded to `['http://localhost:5173']`
- Will break in production unless updated to actual domain
- Should be configured via environment variable

### Trusted Origins Hardcoded
- `api/src/lib/auth.ts` line 19: `trustedOrigins: ['http://localhost:5173']`
- Same issue as CORS — needs to be configurable for production

### Base URL Hardcoded
- `api/src/lib/auth.ts` line 8: `baseURL: 'http://localhost:${config.port}'`
- better-auth uses this for callback URLs — will break in production

### OpenAI API Key in Config
- `config.openaiApiKey` falls back to env var directly — not encrypted
- Tenant-level keys are encrypted, but the system-wide fallback key is stored in plaintext in memory

## Incomplete Features

### MinIO Integration
- MinIO is configured in `docker-compose.yml` and `config.ts` has MinIO settings
- `sources` table has `fileKey` column for file references
- But no actual MinIO SDK import or file upload/download implementation in route handlers
- File source type exists in schema but appears non-functional

### Lint Queue
- `lintQueue` defined in `api/src/jobs/queues.ts` but no lint worker implementation in `worker.ts`
- `wiki_pages` has `lastLintAt` timestamp field suggesting planned wiki content quality checking
- **Gap**: Queue exists without worker

### Query Queue
- `queryQueue` defined but no corresponding worker — may be intended for async search/chat processing

### Workspace System Prompt
- `workspaces` table has `systemPrompt` column but it's not used in the chat RAG pipeline
- Chat route likely ignores workspace-level prompt customization

## Data Integrity

### Dual Auth Schema
- Two separate organization/member schemas exist:
  1. `api/src/db/schema/auth.ts` — better-auth's `organization`, `member` tables (text IDs)
  2. `api/src/db/schema/workspace.ts` — App's `organizations`, `members` tables (UUID IDs)
- Server routes use the workspace schema for authorization checks
- better-auth uses its own tables for auth
- **Risk**: MEDIUM — Potential data inconsistency if the two org systems diverge

### Chunk Embedding Dedup Flawed
- `extract-job.ts` checks `sourceChunks.contentHash` for existing embedding to reuse
- But it always inserts a new `source_chunks` row regardless — dedup only saves the embedding generation cost, not storage
- Duplicate chunks accumulate across multiple ingestions of similar content

### CAS Conflict Handling
- `build-wiki-job.ts` retries 2 times on CAS failure, then logs an `ingest_conflict` activity log
- No automatic retry or user notification beyond the activity log
- If a page is being concurrently updated by two ingestions, one update is silently lost

## Performance

### N+1 Query Pattern in Build-Wiki
- `build-wiki-job.ts` `createWikiPage()` iterates over `decision.links` with individual DB queries per link
- Each link check → potential stub creation → link insert = 3 queries per link
- For pages with many outgoing links, this could be slow

### Full-Text Search Without GIN Index
- `search/engine.ts` uses `to_tsvector()` and `to_tsquery()` for FTS
- No GIN index defined in the Drizzle schema for the computed `tsvector`
- Full table scan on every search query — will degrade with wiki size

### Vector Search Without HNSW/IVFFlat Index
- Vector similarity search uses raw `<=>` operator without a dedicated vector index
- pgvector requires explicit `CREATE INDEX ... USING hnsw` or `ivfflat` for efficient ANN search
- Current exact search is O(n) — unusable at scale

### Embedding on Every Insert
- `extract-job.ts` generates embeddings synchronously for each chunk during ingestion
- Should batch embedding calls to reduce API round-trips

## Missing Production Infrastructure

### No Health Check Depth
- `routes/health.ts` exists but actual implementation not read — likely basic
- Should verify DB connectivity, Redis connectivity, worker status

### No Rate Limiting
- No request rate limiting middleware on API endpoints
- Tenant concurrency limit exists for ingest but not for general API calls

### No Logging Rotation / Retention
- pino logger configured but no log rotation or retention strategy
- Activity logs in DB have no cleanup/archival mechanism

### No Database Migrations
- `drizzle-kit` is configured but no `drizzle/` migrations directory exists in the codebase
- Using `db:push` (schema push) instead of versioned migrations
- **Risk**: No migration history for production schema changes

### No Error Reporting
- No Sentry, Datadog, or similar APM integration
- Errors logged to console only

### No Deployment Config
- No Dockerfile, no deployment scripts, no CI/CD pipeline
- No PM2 ecosystem file or systemd service config
- Project appears to be in early development stage

## Code Quality

### Type Assertions
- Several `as` type assertions in the codebase, particularly in:
  - `server.ts` — `c.set('userId' as never, ...)` and `c.get('userId' as never)`
  - `build-wiki-job.ts` — `as { count: number }` on raw SQL results
  - `worker.ts` — `as { totalBatches: number; ... }` on JSONB fields
- These bypass TypeScript's type safety

### Inconsistent JSONB Typing
- `ingestState` typed via `$type<>()` on the column but cast again in worker code
- `citations` in messages table typed via `$type<>()` but no runtime validation

### Missing Input Validation on Some Routes
- `@hono/zod-openapi` is a dependency but not all routes appear to use it for request validation
- Some routes may accept unvalidated payloads

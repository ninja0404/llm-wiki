# Technology Stack

## Languages & Runtime

- **TypeScript 5.8** — Strict mode, ESM-only across all packages
- **Node.js 20+** — Runtime for API server and worker
- **Target**: ES2022 with bundler module resolution

## Package Management

- **pnpm 9+** — Workspace-based monorepo with `pnpm-workspace.yaml`
- Three packages: `@llm-wiki/api`, `@llm-wiki/web`, `@llm-wiki/shared`

## Backend Framework

- **Hono 4.7** (`api/src/server.ts`) — Lightweight HTTP framework
  - `@hono/node-server` for Node.js serving
  - `@hono/node-ws` for WebSocket support
  - `@hono/zod-openapi` for request validation
  - CORS middleware, logger middleware
- **BullMQ 5.46** (`api/src/jobs/queues.ts`) — Job queue system
  - 4 queues: `ingest`, `query`, `lint`, `embedding-update`
  - `@bull-board/hono` for queue dashboard UI at `/bull`
- **Drizzle ORM 0.44** (`api/src/lib/db.ts`) — Type-safe SQL ORM
  - `drizzle-kit 0.31` for migrations
  - Relational query API with schema definitions in `api/src/db/schema/`

## Frontend Framework

- **React 19** (`web/src/main.tsx`) — UI library
- **Vite 6.3** (`web/vite.config.ts`) — Build tool with HMR
- **Tailwind CSS 4.1** with `@tailwindcss/vite` plugin
- **React Router 7.5** — Client-side routing
- **Zustand 5** (`web/src/store/`) — Lightweight state management
- **Recharts 2.15** — Dashboard charts
- **react-force-graph-2d 1.26** — Wiki link graph visualization
- **react-markdown 10.1** — Markdown rendering for wiki content
- **react-dropzone 15** — File upload UI
- **cmdk 1.1** — Command palette (Cmd+K)
- **lucide-react** — Icon library
- **clsx + tailwind-merge** — Conditional class utilities

## AI / LLM

- **Vercel AI SDK 4.3** (`ai` package) (`api/src/llm/invoke.ts`)
  - `generateObject()` for structured LLM output with Zod schemas
  - `streamText()` for chat streaming
  - `embed()` for text embedding generation
- **@ai-sdk/openai** — OpenAI provider (also used for custom/Anthropic via base URL override)
- Default model: `gpt-4o-mini`, embedding: `text-embedding-3-small` (1536 dimensions)

## Database

- **PostgreSQL 16** with extensions:
  - `pgvector` — Vector similarity search (1536-dim embeddings)
  - `pg_trgm` — Trigram-based fuzzy text matching
- Docker image: `pgvector/pgvector:pg16`
- Connection pool: `pg.Pool` with max 20 connections

## Cache & Queue Backend

- **Redis 7** (Alpine) — BullMQ backend, token budget tracking, circuit breaker state, WebSocket pub/sub
- **ioredis 5.6** client with retry strategy

## Object Storage

- **MinIO** (S3-compatible) — File uploads storage
  - API port 9000, Console port 9001
  - Bucket: `llmwiki`

## Connection Pooling

- **PgBouncer** — Transaction-mode connection pooler
  - Max 200 client connections, pool size 20
  - Sits between app and PostgreSQL on port 6432

## Authentication

- **better-auth 1.2** (`api/src/lib/auth.ts`) — Full-featured auth library
  - Email/password provider
  - Organization plugin for multi-tenant support
  - Drizzle adapter for PostgreSQL
  - Session-based auth with cookie tokens

## Logging

- **pino 9.6** (`api/src/lib/logger.ts`) — Structured JSON logging
  - `pino-pretty` for dev environment colorized output

## Security

- **AES-256-GCM** encryption (`api/src/lib/crypto.ts`) — For tenant API keys
- **SSRF protection** (`api/src/lib/ssrf.ts`) — DNS validation, blocked private IP ranges
- **Zod** schema validation on all inputs

## Configuration

- **dotenv** — `.env` file at project root, loaded via `api/src/lib/config.ts`
- Config object exported as `const` for type safety
- TypeScript project references via `tsconfig.base.json`

## Build & Dev

- `tsx` — TypeScript execution with watch mode for development
- `tsc` — Standard TypeScript compilation for production builds
- Output to `dist/` directories per package

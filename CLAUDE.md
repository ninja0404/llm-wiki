<!-- GSD:project-start source:PROJECT.md -->
## Project

**LLM Wiki — Phase 0 Completion & Production Hardening**

LLM Wiki 是一个企业级多租户 SaaS 知识库产品。用户上传原始资料（文本/URL），LLM 自动提取实体并构建互相链接的 Wiki 知识库，支持语义+全文混合搜索、RAG 对话式查询、知识图谱可视化。基于 Karpathy 的 LLM Wiki 方法论，从"个人文件夹 + CLI"升级为"多租户 Web 产品"。

**Core Value:** 用户上传资料后，LLM 自动构建高质量、互相链接的 Wiki 知识库，知识不断复利积累。

### Constraints

- **Tech Stack**: 全 TypeScript + ESM-only — 已确定，不可变更
- **Package Manager**: pnpm — 禁止 npm
- **Docker**: docker compose — 禁止 docker-compose
- **Node.js**: >= 20
- **Database**: PostgreSQL 16 + pgvector — 不引入外部向量数据库
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages & Runtime
- **TypeScript 5.8** — Strict mode, ESM-only across all packages
- **Node.js 20+** — Runtime for API server and worker
- **Target**: ES2022 with bundler module resolution
## Package Management
- **pnpm 9+** — Workspace-based monorepo with `pnpm-workspace.yaml`
- Three packages: `@llm-wiki/api`, `@llm-wiki/web`, `@llm-wiki/shared`
## Backend Framework
- **Hono 4.7** (`api/src/server.ts`) — Lightweight HTTP framework
- **BullMQ 5.46** (`api/src/jobs/queues.ts`) — Job queue system
- **Drizzle ORM 0.44** (`api/src/lib/db.ts`) — Type-safe SQL ORM
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
- **@ai-sdk/openai** — OpenAI provider (also used for custom/Anthropic via base URL override)
- Default model: `gpt-4o-mini`, embedding: `text-embedding-3-small` (1536 dimensions)
## Database
- **PostgreSQL 16** with extensions:
- Docker image: `pgvector/pgvector:pg16`
- Connection pool: `pg.Pool` with max 20 connections
## Cache & Queue Backend
- **Redis 7** (Alpine) — BullMQ backend, token budget tracking, circuit breaker state, WebSocket pub/sub
- **ioredis 5.6** client with retry strategy
## Object Storage
- **MinIO** (S3-compatible) — File uploads storage
## Connection Pooling
- **PgBouncer** — Transaction-mode connection pooler
## Authentication
- **better-auth 1.2** (`api/src/lib/auth.ts`) — Full-featured auth library
## Logging
- **pino 9.6** (`api/src/lib/logger.ts`) — Structured JSON logging
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
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Module System
- **ESM-only** — All packages use `"type": "module"` in `package.json`
- Imports use `.js` extension for local files (TypeScript ESM convention): `import { db } from './lib/db.js'`
- Workspace dependencies via `workspace:*` protocol
## TypeScript
- **Strict mode** enabled in base tsconfig
- `isolatedModules: true` for Vite/esbuild compatibility
- Schema types exported alongside table definitions
- `as const` assertions for config objects
- Type-only imports not consistently used (regular imports for types)
## Error Handling
- **Try-catch with non-critical fallback**: Many Redis/secondary operations silently catch errors with `/* non-critical */` comments, allowing core flow to continue
- **Custom error classes**: `CircuitBreakerOpenError`, `SsrfError`, `ApiError` — each extends `Error` with a `name` property
- **Circuit breaker pattern**: LLM failures tracked in Redis; after 5 failures within 10 minutes, all calls short-circuit with `CircuitBreakerOpenError`
- **Job retries**: BullMQ jobs configured with exponential backoff (3 attempts for ingest, 2 for query/lint)
## Database Patterns
- **Drizzle ORM**: Schema-first approach with `pgTable()` definitions
- **Relations**: Defined separately via `relations()` function alongside table schemas
- **Custom types**: `vector` custom type wrapping pgvector's `vector(1536)` column
- **Indexes**: Explicit index definitions within table factory functions
- **Unique constraints**: Via `uniqueIndex()` for business keys (e.g., `workspace_id + slug`)
- **Soft delete**: `deletedAt` timestamp on `wiki_pages` (filtered with `IS NULL` in queries)
- **Optimistic locking**: `lockVersion` integer field with CAS updates on `wiki_pages`
- **UUID primary keys**: All tables use `uuid().primaryKey().defaultRandom()`
- **Cascade deletes**: Foreign keys with `onDelete: 'cascade'` for parent-child relationships
- **Conflict handling**: `onConflictDoNothing()` for idempotent inserts, `onConflictDoUpdate()` for upserts
## LLM Integration Patterns
- **Structured output**: All LLM calls use `generateObject()` with Zod schemas — never raw text parsing
- **Prompt versioning**: Every prompt has a version string (e.g., `extract-v1`, `wiki-build-v1`) logged per invocation
- **Cost estimation**: `estimateCostUsd()` function with hardcoded per-token pricing table
- **Token budgeting**: Two-tier budget system — monthly workspace limit + per-ingest source limit
- **Budget reserve/adjust**: Tokens reserved before LLM call, adjusted to actual usage after completion
## API Patterns
- **Route organization**: Each route file exports a Hono sub-app, composed in `server.ts` via `app.route()`
- **Auth middleware**: Session check via `auth.api.getSession()` on every protected route
- **Workspace scoping**: Additional middleware checks organization membership before workspace operations
- **Context passing**: `userId` set via `c.set('userId', ...)` in middleware, read in handlers
- **WebSocket events**: All mutations publish real-time events via `publishMessage()` for live UI updates
## Frontend Patterns
- **State management**: Zustand stores with flat state shape (no nested selectors)
- **Session loading**: `SessionLoader` component fetches session on mount, populates auth + workspace stores
- **Auth guard**: `AuthGuard` component redirects to `/login` if not authenticated
- **API client**: Class-based `ApiClient` with typed generic methods (`get<T>()`, `post<T>()`)
- **WebSocket**: `useWs` hook manages connection lifecycle with exponential backoff reconnection
- **CSS**: Tailwind CSS v4 with `clsx + tailwind-merge` for conditional classes
## Naming Conventions
| Scope | Convention | Example |
|-------|-----------|---------|
| DB tables | snake_case plural | `wiki_pages`, `source_chunks` |
| DB columns | snake_case | `workspace_id`, `created_at` |
| TS files | kebab-case | `build-wiki-job.ts`, `circuit-breaker.ts` |
| TS interfaces | PascalCase | `WikiPageSummary`, `TenantLLMConfig` |
| Constants | UPPER_SNAKE_CASE | `EXTRACT_BATCH_SIZE`, `RRF_K` |
| React components | PascalCase | `DashboardView`, `CommandPalette` |
| React hooks | camelCase with `use` prefix | `useWs`, `useAuthStore` |
| API paths | kebab-case | `/api/workspaces/:workspaceId/sources` |
| Zod schemas | camelCase + Schema suffix | `extractSchema`, `wikiDecisionSchema` |
## Shared Constants
- Pipeline config: `CHUNK_SIZE=1500`, `CHUNK_OVERLAP=200`, `EXTRACT_BATCH_SIZE=8`, `BUILD_BATCH_SIZE=4`
- Budgets: `DEFAULT_TOKEN_BUDGET_MONTHLY=2M`, `DEFAULT_TOKEN_BUDGET_PER_INGEST=100K`
- Search: `RRF_K=60`, `SEARCH_TOP_K=20`
- Resilience: `CIRCUIT_BREAKER_THRESHOLD=5`, `CIRCUIT_BREAKER_TTL_S=600`, `LLM_TIMEOUT_MS=60000`
- WebSocket: `WS_RECONNECT_MIN_MS=1000`, `WS_RECONNECT_MAX_MS=30000`
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## System Overview
## Architectural Pattern
```
```
## Multi-Tenancy Model
- **Users** belong to **Organizations** via **Members** (roles: owner, admin, editor, viewer)
- **Organizations** own **Workspaces** — each workspace is an isolated knowledge base
- All workspace-scoped API routes enforce organization membership via middleware (`api/src/server.ts` lines 146-163)
- Token budgets tracked per-workspace per-month via Redis
## Data Flow: Source Ingestion Pipeline
```
```
## Data Flow: Hybrid Search
```
```
## Data Flow: RAG Chat
```
```
## LLM Resilience Layer
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
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->

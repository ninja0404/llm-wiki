# Code Conventions

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

All magic numbers and enums are centralized in `packages/shared/src/constants.ts`:
- Pipeline config: `CHUNK_SIZE=1500`, `CHUNK_OVERLAP=200`, `EXTRACT_BATCH_SIZE=8`, `BUILD_BATCH_SIZE=4`
- Budgets: `DEFAULT_TOKEN_BUDGET_MONTHLY=2M`, `DEFAULT_TOKEN_BUDGET_PER_INGEST=100K`
- Search: `RRF_K=60`, `SEARCH_TOP_K=20`
- Resilience: `CIRCUIT_BREAKER_THRESHOLD=5`, `CIRCUIT_BREAKER_TTL_S=600`, `LLM_TIMEOUT_MS=60000`
- WebSocket: `WS_RECONNECT_MIN_MS=1000`, `WS_RECONNECT_MAX_MS=30000`

# Directory Structure

## Project Root

```
llm-wiki/
├── .env                    # Environment variables (gitignored via .env.example)
├── .env.example            # Environment template
├── .gitignore
├── docker-compose.yml      # PostgreSQL(pgvector) + PgBouncer + Redis + MinIO
├── package.json            # Root workspace config (pnpm monorepo)
├── pnpm-workspace.yaml     # Declares packages: api, web, packages/*
├── pnpm-lock.yaml
├── tsconfig.base.json      # Shared TypeScript config (ES2022, strict, ESM)
├── scripts/
│   └── init-db.sql         # CREATE EXTENSION vector, pg_trgm
├── api/                    # Backend: Hono + BullMQ + Drizzle
├── web/                    # Frontend: React + Vite + Tailwind
└── packages/
    └── shared/             # Shared types, constants, WebSocket message types
```

## API Package (`api/`)

```
api/
├── package.json            # @llm-wiki/api — Hono, BullMQ, Drizzle, AI SDK
├── tsconfig.json           # Extends base, outDir: ./dist
├── drizzle.config.ts       # Drizzle Kit config → PostgreSQL
├── dist/                   # Compiled JS output
└── src/
    ├── server.ts           # HTTP + WebSocket entry point
    ├── worker.ts           # BullMQ worker entry point
    │
    ├── db/schema/          # Drizzle ORM schema definitions
    │   ├── index.ts        # Re-exports all schemas
    │   ├── auth.ts         # user, session, account, verification, organization, member, invitation
    │   ├── workspace.ts    # organizations, members, workspaces (app-level)
    │   ├── source.ts       # sources, source_chunks, source_extractions + custom vector type
    │   ├── wiki.ts         # wiki_pages, wiki_page_versions, wiki_page_chunks, wiki_links
    │   ├── chat.ts         # conversations, messages (with citations JSONB)
    │   └── system.ts       # activity_logs, llm_invocations, workspace_usage
    │
    ├── lib/                # Shared infrastructure
    │   ├── config.ts       # Environment config object
    │   ├── db.ts           # Drizzle + pg.Pool singleton
    │   ├── redis.ts        # ioredis singleton with retry
    │   ├── auth.ts         # better-auth instance (email/password + org plugin)
    │   ├── ws.ts           # WebSocket room management + Redis pub/sub
    │   ├── crypto.ts       # AES-256-GCM encrypt/decrypt for API keys
    │   ├── ssrf.ts         # URL validation + SSRF-safe fetch
    │   └── logger.ts       # pino logger (JSON prod, pretty dev)
    │
    ├── llm/                # LLM abstraction layer
    │   ├── provider.ts     # Model factory (OpenAI/Anthropic/Custom) + API key resolver
    │   ├── invoke.ts       # invokeStructured() + invokeStream() + generateEmbedding()
    │   ├── prompts.ts      # System prompts + prompt builders (extract, wiki-build, query-rewrite)
    │   ├── schemas.ts      # Zod schemas for LLM outputs (extractSchema, wikiDecisionSchema, queryRewriteSchema)
    │   ├── circuit-breaker.ts  # Redis-backed circuit breaker (5 failures → 10 min cooldown)
    │   └── token-budget.ts # Redis-backed token budget (monthly + per-ingest limits)
    │
    ├── ingest/             # Source processing pipeline
    │   ├── extract-job.ts  # Chunk → embed → LLM extract → persist entities
    │   ├── build-wiki-job.ts   # Entities → LLM wiki decisions → create/update pages
    │   ├── chunker.ts      # Paragraph-based text splitting with overlap
    │   └── slugify.ts      # Entity name → URL slug with stop word removal + dedup merge
    │
    ├── search/
    │   └── engine.ts       # Hybrid search: vector + FTS + RRF merge
    │
    ├── jobs/
    │   └── queues.ts       # BullMQ queue definitions (ingest, query, lint, embedding-update)
    │
    └── routes/             # Hono route handlers
        ├── health.ts       # GET /health
        ├── me.ts           # GET /api/me — user info + workspaces
        ├── workspaces.ts   # Workspace CRUD
        ├── sources.ts      # Source CRUD + ingest trigger
        ├── sources-retry.ts    # Retry failed source ingestions
        ├── wiki.ts         # Wiki page CRUD + manual edit
        ├── search.ts       # Hybrid search endpoint
        ├── chat.ts         # RAG chat with streaming
        ├── dashboard.ts    # Usage stats + metrics
        ├── activity.ts     # Activity log viewer
        └── flagged.ts      # Flagged page review queue
```

## Web Package (`web/`)

```
web/
├── package.json            # @llm-wiki/web — React 19, Vite 6, Tailwind 4
├── tsconfig.json           # Extends base, paths: @/* → ./src/*
├── tsconfig.node.json      # Node config for vite.config.ts
├── vite.config.ts          # React plugin + API proxy + Tailwind plugin
├── index.html              # SPA entry
├── dist/                   # Production build output
└── src/
    ├── main.tsx            # React DOM render
    ├── App.tsx             # Router + AuthGuard + SessionLoader
    ├── index.css           # Tailwind imports + custom styles
    ├── vite-env.d.ts       # Vite type declarations
    │
    ├── lib/
    │   ├── api.ts          # ApiClient class (GET/POST/PUT/DELETE with credentials)
    │   ├── cn.ts           # clsx + tailwind-merge utility
    │   └── useWs.ts        # WebSocket hook with exponential backoff reconnect
    │
    ├── store/
    │   ├── auth.ts         # Zustand: user state + loading
    │   └── workspace.ts    # Zustand: workspace list + current selection
    │
    ├── components/
    │   ├── Layout.tsx       # App shell with sidebar navigation
    │   └── CommandPalette.tsx   # Cmd+K command palette (cmdk)
    │
    └── views/              # Page components (one per route)
        ├── LoginView.tsx    # /login — Email/password auth
        ├── DashboardView.tsx    # / — Usage stats, recent activity
        ├── SourcesView.tsx  # /sources — Upload/manage sources
        ├── WikiView.tsx     # /wiki, /wiki/:slug — Browse/read wiki
        ├── SearchView.tsx   # /search — Hybrid search UI
        ├── ChatView.tsx     # /chat — RAG chat interface
        ├── GraphView.tsx    # /graph — Force-directed link graph
        ├── ActivityView.tsx # /activity — Activity log
        └── SettingsView.tsx # /settings — Workspace settings
```

## Shared Package (`packages/shared/`)

```
packages/shared/
├── package.json            # @llm-wiki/shared — Pure TypeScript types + constants
├── tsconfig.json           # Extends base
└── src/
    ├── index.ts            # Re-exports all modules
    ├── constants.ts        # Shared constants: chunk sizes, budgets, thresholds, enums
    ├── api-types.ts        # API request/response type definitions
    └── ws-types.ts         # WebSocket message type union (7 event types)
```

## Key Naming Conventions

- **Database tables**: snake_case plural (`wiki_pages`, `source_chunks`, `activity_logs`)
- **TypeScript files**: kebab-case (`build-wiki-job.ts`, `circuit-breaker.ts`)
- **Schema files**: Domain-grouped (`auth.ts`, `wiki.ts`, `source.ts`, `chat.ts`, `system.ts`)
- **Route files**: Resource-named matching API paths (`sources.ts`, `wiki.ts`, `chat.ts`)
- **Shared types**: PascalCase interfaces suffixed with `Summary`, `Detail`, `Request` (`WikiPageSummary`, `CreateTextSourceRequest`)

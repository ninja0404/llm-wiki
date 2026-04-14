# Testing

## Current State

**No test infrastructure is currently set up.** The project has no:

- Test framework configured (no jest, vitest, or mocha)
- Test files in any package
- Test scripts in package.json
- CI/CD pipeline
- Code coverage tooling

## What Would Need Testing

### API Layer (High Priority)
- **Ingest pipeline**: `extract-job.ts`, `build-wiki-job.ts` — core business logic
- **Chunker**: `chunker.ts` — text splitting with overlap (pure function, easy to unit test)
- **Slugify**: `slugify.ts` — entity name normalization + merge (pure function)
- **Search engine**: `engine.ts` — RRF merge logic (pure function for merge, needs DB for search)
- **Circuit breaker**: `circuit-breaker.ts` — state transitions (needs Redis mock)
- **Token budget**: `token-budget.ts` — reserve/adjust/exceed logic (needs Redis mock)
- **SSRF guard**: `ssrf.ts` — URL validation against blocked ranges (pure function)
- **Crypto**: `crypto.ts` — encrypt/decrypt round-trip (pure function)

### Frontend Layer (Medium Priority)
- **WebSocket hook**: `useWs.ts` — reconnection behavior
- **API client**: `api.ts` — error handling, auth header injection
- **Auth flow**: Session loading, guard redirects

### Integration Tests (High Priority)
- **Full ingest pipeline**: Source → chunks → extract → wiki pages
- **Search accuracy**: Vector + FTS + RRF results
- **Auth flow**: Register → login → workspace access
- **WebSocket events**: Ingest progress → frontend updates

## Recommended Test Setup

Given the tech stack:
- **Vitest** — Native ESM support, Vite integration for frontend tests
- **@testcontainers/postgresql** + **@testcontainers/redis** — For integration tests requiring real DB/cache
- **MSW (Mock Service Worker)** — For mocking OpenAI API in ingest tests
- **Testing Library** — For React component tests

## Test-Friendly Code

Several modules are already well-structured for testing:
- `chunker.ts` — Pure function, no side effects
- `slugify.ts` — Pure function, deterministic
- `engine.ts` `rrfMerge()` — Pure function with clear inputs/outputs
- `ssrf.ts` `validateUrl()` — Isolated DNS lookup, mockable
- `circuit-breaker.ts` — Clear state machine with Redis as only dependency
- `provider.ts` — Factory pattern, can inject test configs

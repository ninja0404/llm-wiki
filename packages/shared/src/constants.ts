// ── Ingest Pipeline ──
export const INDEX_TOKEN_BUDGET = 8000;
export const EXTRACT_BATCH_SIZE = 8;
export const BUILD_BATCH_SIZE = 4;
export const MAX_CHUNKS_PER_SOURCE = 500;
export const CHUNK_SIZE = 1500;
export const CHUNK_OVERLAP = 200;

// ── Tenant Limits ──
export const TENANT_MAX_CONCURRENT_INGEST = 5;
export const DEFAULT_TOKEN_BUDGET_MONTHLY = 2_000_000;
export const DEFAULT_TOKEN_BUDGET_PER_INGEST = 100_000;
export const BUDGET_ALERT_THRESHOLD = 0.8;

// ── Search ──
export const RRF_K = 60;
export const SEARCH_TOP_K = 20;
export const VECTOR_DIMENSION = 1536;

// ── LLM Resilience ──
export const LLM_TIMEOUT_MS = 60_000;
export const INGEST_BATCH_TIMEOUT_MS = 5 * 60_000;
export const CIRCUIT_BREAKER_THRESHOLD = 5;
export const CIRCUIT_BREAKER_TTL_S = 600;
export const RETRY_MAX_ATTEMPTS = 3;
export const RETRY_BASE_DELAY_MS = 5_000;

// ── WebSocket ──
export const WS_RECONNECT_MIN_MS = 1_000;
export const WS_RECONNECT_MAX_MS = 30_000;
export const WS_HEARTBEAT_INTERVAL_MS = 30_000;

// ── Embedding ──
export const EMBEDDING_MODEL_DEFAULT = 'text-embedding-3-small';
export const EMBEDDING_DIMENSION = 1536;

// ── Roles ──
export const ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

// ── Source Status ──
export const SOURCE_STATUSES = ['pending', 'processing', 'completed', 'partial_failure', 'failed'] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

// ── Wiki Page Status ──
export const WIKI_PAGE_STATUSES = ['draft', 'published', 'archived', 'flagged'] as const;
export type WikiPageStatus = (typeof WIKI_PAGE_STATUSES)[number];

// ── Wiki Page Type ──
export const WIKI_PAGE_TYPES = ['entity', 'concept', 'source_summary', 'comparison', 'overview'] as const;
export type WikiPageType = (typeof WIKI_PAGE_TYPES)[number];

// ── Entity Type ──
export const ENTITY_TYPES = ['person', 'project', 'technology', 'company', 'concept', 'methodology'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

// ── Change Type ──
export const CHANGE_TYPES = ['llm_ingest', 'llm_lint', 'manual_edit'] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

// ── Confidence Level ──
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

import type {
  SourceStatus,
  WikiPageStatus,
  WikiPageType,
  ConfidenceLevel,
  Role,
} from './constants.js';

// ── Auth ──

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface AuthResponse {
  token: string;
  user: UserSummary;
}

export interface UserSummary {
  id: string;
  email: string;
  name: string;
}

// ── Organization ──

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

// ── Workspace ──

export interface WorkspaceSummary {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface CreateWorkspaceRequest {
  name: string;
  description?: string;
}

// ── Source ──

export interface SourceSummary {
  id: string;
  title: string;
  sourceType: 'text' | 'url' | 'file';
  status: SourceStatus;
  ingestState: IngestState | null;
  contentHash: string | null;
  createdAt: string;
}

export interface IngestState {
  totalBatches: number;
  completedBatches: number;
  failedBatches: number[];
}

export interface CreateTextSourceRequest {
  title: string;
  content: string;
}

export interface CreateUrlSourceRequest {
  title: string;
  url: string;
}

// ── Wiki Page ──

export interface WikiPageSummary {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  pageType: WikiPageType;
  status: WikiPageStatus;
  tags: string[];
  confidence: ConfidenceLevel | null;
  updatedAt: string;
}

export interface WikiPageDetail extends WikiPageSummary {
  content: string;
  lockVersion: number;
  sources: { id: string; title: string }[];
  links: { id: string; title: string; slug: string }[];
  backlinks: { id: string; title: string; slug: string }[];
  createdAt: string;
}

// ── Search ──

export interface SearchRequest {
  query: string;
  limit?: number;
  offset?: number;
  pageType?: WikiPageType;
  tags?: string[];
}

export interface SearchResult {
  pages: WikiPageSummary[];
  total: number;
  query: string;
}

// ── Conversation / Chat ──

export interface ConversationSummary {
  id: string;
  title: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MessageSummary {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[] | null;
  createdAt: string;
}

export interface Citation {
  wikiPageId: string;
  wikiPageTitle: string;
  sourceChunkId: string | null;
  excerpt: string;
}

export interface ChatRequest {
  conversationId?: string;
  message: string;
}

// ── Activity Log ──

export interface ActivityLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  details: Record<string, unknown> | null;
  traceId: string | null;
  userId: string | null;
  createdAt: string;
}

// ── Workspace Usage ──

export interface WorkspaceUsageSummary {
  period: string;
  tokensUsed: number;
  tokensBudget: number;
  storageBytes: number;
  apiCalls: number;
}

// ── Graph ──

export interface GraphNode {
  id: string;
  title: string;
  slug: string;
  pageType: WikiPageType;
  linkCount: number;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

// ── Common ──

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

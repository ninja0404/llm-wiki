CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgroonga;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE member_role AS ENUM ('owner', 'admin', 'editor', 'viewer');
CREATE TYPE document_kind AS ENUM ('source', 'wiki', 'system', 'asset');
CREATE TYPE document_status AS ENUM ('draft', 'queued', 'processing', 'ready', 'failed', 'archived');
CREATE TYPE document_policy AS ENUM ('system_managed', 'agent_editable', 'append_only', 'locked');
CREATE TYPE actor_type AS ENUM ('human', 'agent', 'system');
CREATE TYPE run_type AS ENUM ('ingest', 'compile', 'lint', 'query', 'agent_edit');
CREATE TYPE run_status AS ENUM ('queued', 'running', 'succeeded', 'failed');
CREATE TYPE change_op AS ENUM ('create_doc', 'replace_section', 'append_content', 'update_links', 'archive_doc');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role member_role NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, slug)
);

CREATE TABLE workspace_settings (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  llm_provider TEXT NOT NULL DEFAULT 'openai',
  llm_model TEXT NOT NULL DEFAULT 'gpt-4.1-mini',
  embedding_provider TEXT NOT NULL DEFAULT 'openai',
  embedding_model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  compiler_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  search_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'write',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_type run_type NOT NULL,
  status run_status NOT NULL DEFAULT 'queued',
  actor_type actor_type NOT NULL,
  actor_id TEXT,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE run_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  status run_status NOT NULL DEFAULT 'queued',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind document_kind NOT NULL,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  status document_status NOT NULL DEFAULT 'draft',
  policy document_policy NOT NULL DEFAULT 'agent_editable',
  current_revision_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE document_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  actor_type actor_type NOT NULL,
  actor_id TEXT,
  run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  content_md TEXT NOT NULL,
  content_ast JSONB NOT NULL DEFAULT '{}'::jsonb,
  diff_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE documents
  ADD CONSTRAINT documents_current_revision_fkey
  FOREIGN KEY (current_revision_id) REFERENCES document_revisions(id) ON DELETE SET NULL;

CREATE TABLE document_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_no INTEGER NOT NULL,
  text_md TEXT NOT NULL,
  elements_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  char_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, page_no)
);

CREATE TABLE document_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_no INTEGER NOT NULL DEFAULT 1,
  block_type TEXT NOT NULL,
  heading_path TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  text TEXT NOT NULL,
  bbox JSONB NOT NULL DEFAULT '{}'::jsonb,
  token_count INTEGER NOT NULL DEFAULT 0,
  embedding VECTOR(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, slug)
);

CREATE TABLE claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,
  canonical_text TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
  target_entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  claim_id UUID REFERENCES claims(id) ON DELETE CASCADE,
  source_document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  source_block_id UUID REFERENCES document_blocks(id) ON DELETE SET NULL,
  page_no INTEGER,
  quote_text TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE document_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  target_document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ref_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_document_id, target_document_id, ref_type)
);

CREATE TABLE activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_type actor_type NOT NULL,
  actor_id TEXT,
  event_type TEXT NOT NULL,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_active ON sessions (user_id, expires_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX idx_org_members_user ON organization_members(user_id);
CREATE INDEX idx_workspace_org ON workspaces(organization_id);
CREATE INDEX idx_agent_tokens_workspace ON agent_tokens(workspace_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_runs_workspace ON runs(workspace_id, created_at DESC);
CREATE INDEX idx_run_steps_run ON run_steps(run_id, created_at);
CREATE INDEX idx_activity_workspace ON activity_events(workspace_id, created_at DESC);
CREATE UNIQUE INDEX idx_documents_workspace_path ON documents(workspace_id, path) WHERE archived_at IS NULL;
CREATE INDEX idx_documents_workspace_kind ON documents(workspace_id, kind, updated_at DESC);
CREATE INDEX idx_document_pages_document ON document_pages(document_id, page_no);
CREATE INDEX idx_document_blocks_document ON document_blocks(document_id, page_no);
CREATE INDEX idx_entities_workspace ON entities(workspace_id, entity_type, updated_at DESC);
CREATE INDEX idx_claims_workspace ON claims(workspace_id, updated_at DESC);
CREATE INDEX idx_relations_workspace ON relations(workspace_id, relation_type);
CREATE UNIQUE INDEX idx_relations_unique_pair ON relations(workspace_id, source_entity_id, target_entity_id, relation_type);
CREATE INDEX idx_citations_claim ON citations(claim_id);
CREATE INDEX idx_doc_refs_source ON document_references(source_document_id);

CREATE INDEX idx_documents_title_pgroonga ON documents USING pgroonga (title);
CREATE INDEX idx_document_blocks_text_pgroonga ON document_blocks USING pgroonga (text);
CREATE INDEX idx_claims_text_pgroonga ON claims USING pgroonga (canonical_text);

CREATE INDEX idx_documents_title_trgm ON documents USING gin (title gin_trgm_ops);
CREATE INDEX idx_document_blocks_text_trgm ON document_blocks USING gin (text gin_trgm_ops);
CREATE INDEX idx_claims_text_trgm ON claims USING gin (canonical_text gin_trgm_ops);

CREATE INDEX idx_document_blocks_embedding_hnsw
  ON document_blocks USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_orgs_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_workspaces_updated_at BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_workspace_settings_updated_at BEFORE UPDATE ON workspace_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_documents_updated_at BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_entities_updated_at BEFORE UPDATE ON entities FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_claims_updated_at BEFORE UPDATE ON claims FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO organizations (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'System Organization', 'system')
ON CONFLICT (slug) DO NOTHING;

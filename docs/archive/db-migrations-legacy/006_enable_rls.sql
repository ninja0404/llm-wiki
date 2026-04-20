-- Row Level Security: enforce workspace_id isolation at the database level.
--
-- How it works:
--   1. The application calls SET app.workspace_id = '<uuid>' on each connection
--   2. Policies check current_setting('app.workspace_id') against the row's workspace_id
--   3. Rows from other workspaces are invisible to queries
--
-- Deployment notes:
--   - In development the pool user typically owns the tables and bypasses RLS.
--   - In production, create a non-owner app role (e.g. llmwiki_app) with
--     GRANT SELECT, INSERT, UPDATE, DELETE on all tables.
--     That role is subject to RLS without FORCE.
--   - Internal services (compiler worker) should connect as the owner role.
--   - To enforce RLS even for the owner, add FORCE ROW LEVEL SECURITY to each table.

-- Helper: create a non-owner app role (run manually in production)
-- CREATE ROLE llmwiki_app LOGIN PASSWORD '...';
-- GRANT USAGE ON SCHEMA public TO llmwiki_app;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO llmwiki_app;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO llmwiki_app;

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_documents ON documents
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE document_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_document_blocks ON document_blocks
  USING (document_id IN (
    SELECT id FROM documents WHERE workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
  ));

ALTER TABLE document_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_document_pages ON document_pages
  USING (document_id IN (
    SELECT id FROM documents WHERE workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
  ));

ALTER TABLE document_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_document_revisions ON document_revisions
  USING (document_id IN (
    SELECT id FROM documents WHERE workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
  ));

ALTER TABLE document_references ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_document_references ON document_references
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_entities ON entities
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_claims ON claims
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE relations ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_relations ON relations
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE citations ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_citations ON citations
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_runs ON runs
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE run_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_run_steps ON run_steps
  USING (run_id IN (
    SELECT id FROM runs WHERE workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
  ));

ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_activity_events ON activity_events
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE workspace_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_workspace_settings ON workspace_settings
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE agent_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_agent_tokens ON agent_tokens
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

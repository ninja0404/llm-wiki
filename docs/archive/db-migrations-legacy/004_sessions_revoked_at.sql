ALTER TABLE sessions ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_sessions_active
  ON sessions (user_id, expires_at DESC) WHERE revoked_at IS NULL;

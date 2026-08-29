CREATE TABLE IF NOT EXISTS user_oauth_tokens (
  user_id TEXT NOT NULL,
  tenant_id TEXT,
  person_uuid TEXT,

  provider TEXT NOT NULL,
  account_identifier TEXT NOT NULL DEFAULT '',

  access_token TEXT,
  refresh_token TEXT,

  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,

  scope TEXT,
  scopes TEXT,
  expires_at INTEGER,

  account_email TEXT,
  account_display TEXT,
  workspace_id TEXT,
  metadata_json TEXT,

  created_at INTEGER,
  updated_at INTEGER,

  is_active INTEGER NOT NULL DEFAULT 1,
  revoked_at INTEGER,
  revoked_by TEXT,

  last_refresh_at INTEGER,
  last_refresh_error_code TEXT,
  refresh_failure_count INTEGER NOT NULL DEFAULT 0,

  PRIMARY KEY (user_id, provider, account_identifier)
);

CREATE INDEX IF NOT EXISTS idx_user_oauth_tokens_user_provider
  ON user_oauth_tokens(user_id, provider);

CREATE INDEX IF NOT EXISTS idx_user_oauth_tokens_active
  ON user_oauth_tokens(user_id, is_active, revoked_at);

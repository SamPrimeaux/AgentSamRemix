-- AgentSam Identity — customer D1 core (portable, boring, growable)
-- Timestamps: INTEGER unixepoch seconds (AGENTS.md §2)

CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT,
  password_hash TEXT,
  salt TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users(email);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  email TEXT,
  provider TEXT,
  provider_subject TEXT,
  display_name TEXT,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_expires
  ON auth_sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS account_identities (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  email TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES auth_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_identities_provider_subject
  ON account_identities(provider, provider_subject);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  redirect_to TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id)
);

-- Single-tenant company profile (branding, logo, support info). Grow to multi-tenant via slug.
CREATE TABLE IF NOT EXISTS company (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  legal_name TEXT,
  logo_url TEXT,
  favicon_url TEXT,
  primary_color TEXT,
  auth_bg_color TEXT,
  support_email TEXT,
  website_url TEXT,
  tagline TEXT,
  meta_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_slug ON company(slug);

-- Default company row (branding SSOT for portal + dashboard)
INSERT OR IGNORE INTO company (
  id, slug, name, logo_url, auth_bg_color, primary_color, created_at, updated_at
) VALUES (
  'co_default',
  'default',
  'auth-scaffold',
  '/brand/logo.svg',
  '#050508',
  '#007AFF',
  1787976434,
  1787976434
);

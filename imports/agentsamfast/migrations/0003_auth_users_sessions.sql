-- ============================================================================
-- AgentSam Cloudflare D1 / SQLite Migrations
-- Version: 0003_auth_users_sessions.sql
-- Description: Core Authentication, User Identities, and Auth Sessions Schema
-- ============================================================================

CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  tenant_id TEXT,
  is_superadmin INTEGER DEFAULT 0,
  superadmin_group_id TEXT,
  is_verified INTEGER NOT NULL DEFAULT 0,
  verified_at INTEGER,
  superadmin_uuid TEXT,
  superadmin_identity_id TEXT,
  person_uuid TEXT,
  supabase_user_id TEXT,
  status TEXT DEFAULT 'active',
  active_tenant_id TEXT,
  active_workspace_id TEXT,
  display_name TEXT,
  avatar_url TEXT,
  last_login_at INTEGER,
  login_count INTEGER DEFAULT 0,
  phone TEXT,
  mfa_enabled INTEGER DEFAULT 0,
  timezone TEXT DEFAULT 'America/Chicago',
  user_key TEXT,
  default_workspace_id TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  account_type TEXT NOT NULL DEFAULT 'human',
  identity_label TEXT,
  iam_owned INTEGER NOT NULL DEFAULT 0,
  downgrade_protected INTEGER NOT NULL DEFAULT 0,
  notification_email TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}',
  last_active_at INTEGER,
  auth_rev INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  ip_address TEXT,
  user_agent TEXT,
  tenant_id TEXT,
  supabase_user_id TEXT,
  email TEXT,
  provider TEXT DEFAULT 'email',
  display_name TEXT,
  avatar_url TEXT,
  revoked_at TEXT,
  revoke_reason TEXT,
  provider_subject TEXT,
  workspace_id TEXT,
  person_uuid TEXT,
  work_session_id TEXT,
  last_active_at INTEGER,
  type TEXT NOT NULL DEFAULT 'browser',
  token_hash TEXT,
  org_id TEXT
);

-- Performance & Security Indexes
CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users(email);
CREATE INDEX IF NOT EXISTS idx_auth_users_tenant ON auth_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_auth_users_status ON auth_users(status);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_active ON auth_sessions(revoked_at, expires_at);

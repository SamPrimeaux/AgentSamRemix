-- ============================================================================
-- AgentSam Cloudflare D1 / SQLite Migrations
-- Version: 0002_agentsam_auth_integrations.sql
-- Description: User Integrations, Encrypted OAuth Tokens, User Secrets Vault,
--              UI Preferences SSOT, and Core Agent Execution Ledger Tables.
-- ============================================================================

-- 1. User Integrations Table
CREATE TABLE IF NOT EXISTS user_integrations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_email TEXT NOT NULL,
  service_name TEXT NOT NULL,
  service_type TEXT NOT NULL,
  api_key TEXT,
  config TEXT,
  is_connected INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  last_used DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  tenant_id TEXT,
  user_id TEXT,
  auth_method TEXT CHECK(auth_method IN ('api_key','oauth','webhook','bridge','none')),
  key_preview TEXT,
  scopes TEXT,
  webhook_url TEXT,
  person_uuid TEXT,
  UNIQUE(user_email, service_name)
);

-- 2. Canonical User OAuth Tokens (AES Encrypted at rest)
CREATE TABLE IF NOT EXISTS user_oauth_tokens (
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  account_identifier TEXT NOT NULL DEFAULT '',
  access_token TEXT,
  refresh_token TEXT,
  expires_at INTEGER,
  scope TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  scopes TEXT,
  account_email TEXT,
  account_display TEXT,
  tenant_id TEXT,
  person_uuid TEXT,
  workspace_id TEXT,
  metadata_json TEXT,
  vault_access_token_id TEXT DEFAULT NULL,
  vault_refresh_token_id TEXT DEFAULT NULL,
  account_label TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  revoked_at INTEGER,
  revoked_by TEXT,
  last_refresh_at INTEGER,
  last_refresh_error_code TEXT,
  refresh_failure_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, provider, account_identifier)
);

-- 3. Enterprise User Secrets Vault (AES-256-GCM Encrypted)
CREATE TABLE IF NOT EXISTS user_secrets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'system',
  secret_name TEXT NOT NULL,
  secret_value_encrypted TEXT NOT NULL,
  secret_type TEXT DEFAULT 'api_key' CHECK (secret_type IN ('api_key', 'password', 'token', 'credential', 'certificate', 'custom')),
  description TEXT,
  service_name TEXT,
  is_active INTEGER DEFAULT 1,
  expires_at INTEGER,
  last_used_at INTEGER,
  usage_count INTEGER DEFAULT 0,
  scopes_json TEXT DEFAULT '[]',
  metadata_json TEXT DEFAULT '{}',
  tags TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  project_id TEXT,
  project_label TEXT,
  person_uuid TEXT,
  vault_secret_id TEXT DEFAULT NULL,
  workspace_id TEXT DEFAULT NULL,
  UNIQUE(user_id, secret_name, service_name)
);

-- 4. User UI Preferences (Single Source of Truth replacing localStorage)
CREATE TABLE IF NOT EXISTS agentsam_user_ui_preferences (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ui_preferences_json TEXT NOT NULL DEFAULT '{}',
  updated_at_unix INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (workspace_id, user_id)
);

-- 5. Execution Fabric Tables (Powering ExecutionLedger.tsx)
CREATE TABLE IF NOT EXISTS agentsam_agent_run (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'system',
  user_id TEXT NOT NULL,
  session_id TEXT,
  task_title TEXT,
  prompt TEXT NOT NULL,
  model_key TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'google',
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('queued','running','completed','failed','cancelled','interrupted')),
  total_tokens INTEGER DEFAULT 0,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  error_message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS agentsam_executions (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL REFERENCES agentsam_agent_run(id) ON DELETE CASCADE,
  lane TEXT NOT NULL DEFAULT 'primary',
  status TEXT NOT NULL DEFAULT 'running',
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  ended_at INTEGER
);

CREATE TABLE IF NOT EXISTS agentsam_execution_steps (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES agentsam_executions(id) ON DELETE CASCADE,
  agent_run_id TEXT NOT NULL REFERENCES agentsam_agent_run(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  kind TEXT NOT NULL, -- 'thought' | 'command' | 'tool_call' | 'file_edit' | 'approval' | 'verification'
  title TEXT NOT NULL,
  payload_json TEXT DEFAULT '{}',
  result_json TEXT DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'completed',
  duration_ms INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS agentsam_tool_call_log (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL REFERENCES agentsam_agent_run(id) ON DELETE CASCADE,
  step_id TEXT,
  tool_name TEXT NOT NULL,
  tool_category TEXT,
  input_payload_json TEXT NOT NULL DEFAULT '{}',
  output_payload_json TEXT DEFAULT '{}',
  is_error INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS agentsam_tool_chain (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL REFERENCES agentsam_agent_run(id) ON DELETE CASCADE,
  chain_order INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 6. Capabilities & Tools Registry
CREATE TABLE IF NOT EXISTS agentsam_capabilities (
  id TEXT PRIMARY KEY,
  capability_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  requires_oauth INTEGER NOT NULL DEFAULT 0,
  oauth_provider TEXT
);

CREATE TABLE IF NOT EXISTS agentsam_tools (
  id TEXT PRIMARY KEY,
  tool_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  binding_type TEXT NOT NULL, -- 'service' | 'browser' | 'd1' | 'kv' | 'r2' | 'ai' | 'sandbox'
  binding_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS agentsam_tool_capabilities (
  tool_id TEXT NOT NULL REFERENCES agentsam_tools(id) ON DELETE CASCADE,
  capability_id TEXT NOT NULL REFERENCES agentsam_capabilities(id) ON DELETE CASCADE,
  PRIMARY KEY (tool_id, capability_id)
);

-- 7. Governance, Guardrails & Usage Rollups
CREATE TABLE IF NOT EXISTS agentsam_approval_queue (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL REFERENCES agentsam_agent_run(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  action_description TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  decided_by TEXT,
  decided_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS agentsam_guardrail_events (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','blocked')),
  details_json TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS agentsam_usage_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  model_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS agentsam_usage_rollups_daily (
  workspace_id TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  total_runs INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost_usd REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, metric_date)
);

CREATE TABLE IF NOT EXISTS agentsam_agent_experience (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  tags_json TEXT DEFAULT '[]',
  score REAL DEFAULT 1.0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS agentsam_agent_feedback (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL REFERENCES agentsam_agent_run(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating IN (1, -1)),
  feedback_text TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Indexes for lightning fast lookups
CREATE INDEX IF NOT EXISTS idx_oauth_user ON user_oauth_tokens(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_secrets_user ON user_secrets(user_id, service_name);
CREATE INDEX IF NOT EXISTS idx_integrations_email ON user_integrations(user_email);
CREATE INDEX IF NOT EXISTS idx_agent_run_ws ON agentsam_agent_run(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_exec_step_run ON agentsam_execution_steps(agent_run_id);
CREATE INDEX IF NOT EXISTS idx_tool_log_run ON agentsam_tool_call_log(agent_run_id);

-- ============================================================================
-- AgentSam Cloudflare D1 / SQLite Migrations
-- Version: 0008_agentsam_catalog_health_and_schema_delta.sql
-- Description: Complete Model Catalog SSOT, Model Health Circuit Breaker,
--              Routing Arms, ML Observations, Policy Models, Repo Intelligence,
--              Canonical Document & Projection Repositories, and Durable Workflows.
-- ============================================================================

-- 1. Model Catalog (Canonical Single Source of Truth for Models)
CREATE TABLE IF NOT EXISTS agentsam_model_catalog (
  id TEXT PRIMARY KEY,
  model_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,                  -- 'google', 'openai', 'anthropic', 'workers_ai', 'local'
  api_platform TEXT NOT NULL DEFAULT 'standard', -- 'gemini_api', 'openai_api', 'anthropic_api', 'workers_ai', 'perseus'
  provider_model_id TEXT NOT NULL,         -- Actual model id passed over wire, e.g. 'gemini-2.5-pro'
  routing_lane TEXT NOT NULL DEFAULT 'primary' CHECK (routing_lane IN ('primary', 'economy', 'frontier', 'reasoning', 'vision', 'local', 'sandbox')),
  display_name TEXT NOT NULL,
  
  -- Capabilities
  supports_tools INTEGER NOT NULL DEFAULT 1,
  supports_vision INTEGER NOT NULL DEFAULT 0,
  supports_json_mode INTEGER NOT NULL DEFAULT 1,
  supports_streaming INTEGER NOT NULL DEFAULT 1,
  supports_reasoning INTEGER NOT NULL DEFAULT 0,
  supports_code_execution INTEGER NOT NULL DEFAULT 1,
  reasoning_effort TEXT DEFAULT 'medium' CHECK (reasoning_effort IN ('low', 'medium', 'high')),
  
  -- Context and Token Limits
  context_window INTEGER NOT NULL DEFAULT 128000,
  max_output_tokens INTEGER NOT NULL DEFAULT 8192,
  
  -- Pricing (per 1M tokens)
  input_price_per_1m REAL NOT NULL DEFAULT 0.0,
  cached_input_price_per_1m REAL NOT NULL DEFAULT 0.0,
  output_price_per_1m REAL NOT NULL DEFAULT 0.0,
  
  -- Execution Timeout
  timeout_ms INTEGER NOT NULL DEFAULT 60000,
  
  -- Administrative Controls
  is_active INTEGER NOT NULL DEFAULT 1,
  budget_exhausted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_model_catalog_provider ON agentsam_model_catalog(provider, is_active);
CREATE INDEX IF NOT EXISTS idx_model_catalog_lane ON agentsam_model_catalog(routing_lane, is_active);

-- 2. Routing Arms (Bandit / Policy candidate arms)
CREATE TABLE IF NOT EXISTS agentsam_routing_arms (
  id TEXT PRIMARY KEY,
  arm_key TEXT NOT NULL UNIQUE,
  task_type TEXT NOT NULL,                 -- 'code', 'research', 'dossier', 'chat', 'financial_synthesis', 'general', '*'
  mode TEXT NOT NULL DEFAULT '*' CHECK (mode IN ('*', 'ask', 'agent', 'background', 'batch')),
  provider TEXT NOT NULL,
  model_key TEXT NOT NULL,
  
  -- Bayesian Prior / Posterior State
  alpha REAL NOT NULL DEFAULT 1.0,
  beta REAL NOT NULL DEFAULT 1.0,
  pull_count INTEGER NOT NULL DEFAULT 0,
  avg_reward REAL NOT NULL DEFAULT 0.0,
  
  -- Arm Eligibility & Policy Controls
  is_active INTEGER NOT NULL DEFAULT 1,
  is_paused INTEGER NOT NULL DEFAULT 0,
  is_ineligible INTEGER NOT NULL DEFAULT 0,
  budget_exhausted INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 100,
  
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  
  FOREIGN KEY (model_key) REFERENCES agentsam_model_catalog(model_key)
);

CREATE INDEX IF NOT EXISTS idx_routing_arms_lookup ON agentsam_routing_arms(task_type, mode, is_active, is_paused);
CREATE INDEX IF NOT EXISTS idx_routing_arms_model ON agentsam_routing_arms(model_key);

-- 3. Model Health (Circuit Breaker in Front of Routing - Does NOT train Thompson Bandit)
CREATE TABLE IF NOT EXISTS agentsam_model_health (
  id TEXT PRIMARY KEY,
  model_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  health_status TEXT NOT NULL DEFAULT 'healthy' CHECK (health_status IN ('healthy', 'degraded', 'unavailable', 'unknown')),
  
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  last_error_message TEXT,
  last_error_code TEXT,
  
  -- Rate limiting and Quotas
  rate_limited_until INTEGER,               -- Unix epoch timestamp
  quota_exhausted_until INTEGER,            -- Unix epoch timestamp
  
  -- Performance Metrics
  last_latency_ms INTEGER DEFAULT 0,
  avg_latency_ms INTEGER DEFAULT 0,
  error_rate_5m REAL DEFAULT 0.0,
  
  last_checked_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  
  FOREIGN KEY (model_key) REFERENCES agentsam_model_catalog(model_key)
);

CREATE INDEX IF NOT EXISTS idx_model_health_status ON agentsam_model_health(health_status);
CREATE INDEX IF NOT EXISTS idx_model_health_provider ON agentsam_model_health(provider, health_status);

-- 4. Canonical Document Repository (Sources)
CREATE TABLE IF NOT EXISTS agentsam_document_sources (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default_workspace',
  tenant_id TEXT NOT NULL DEFAULT 'default_tenant',
  title TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'document' CHECK (source_type IN ('document', 'code_repo', 'sec_filing', 'transcript', 'web_scrape')),
  source_uri TEXT,
  checksum TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_doc_sources_workspace ON agentsam_document_sources(workspace_id, source_type);

-- 5. Canonical Chunk Repository (Canonical text storage completely decoupled from projections)
CREATE TABLE IF NOT EXISTS agentsam_document_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT REFERENCES agentsam_document_sources(id) ON DELETE CASCADE,
  ticker TEXT,
  form_type TEXT,
  filing_date TEXT,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  section TEXT,
  chunk_text TEXT NOT NULL,                 -- CANONICAL TEXT SOURCE
  token_count INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_doc_chunks_doc ON agentsam_document_chunks(document_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_ticker ON agentsam_document_chunks(ticker, form_type);

-- 6. Canonical Projection Repository (Route/Space-Specific Vectors)
CREATE TABLE IF NOT EXISTS agentsam_chunk_projections (
  id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL REFERENCES agentsam_document_chunks(id) ON DELETE CASCADE,
  embedding_space_key TEXT NOT NULL,        -- 'provider:model:dimensions:pooling:version'
  dimensions INTEGER NOT NULL,
  vector_json TEXT NOT NULL,                -- Exact float array representation
  vector_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(chunk_id, embedding_space_key)
);

CREATE INDEX IF NOT EXISTS idx_projections_chunk_space ON agentsam_chunk_projections(chunk_id, embedding_space_key);
CREATE INDEX IF NOT EXISTS idx_projections_space ON agentsam_chunk_projections(embedding_space_key);

-- 7. Seed Production Catalog Models into D1
INSERT OR REPLACE INTO agentsam_model_catalog (
  id, model_key, provider, api_platform, provider_model_id, routing_lane, display_name,
  supports_tools, supports_vision, supports_json_mode, supports_streaming, supports_reasoning,
  supports_code_execution, reasoning_effort, context_window, max_output_tokens,
  input_price_per_1m, cached_input_price_per_1m, output_price_per_1m, timeout_ms, is_active
) VALUES 
  ('cat_gemini_35_flash', 'gemini-3.5-flash', 'google', 'gemini_api', 'gemini-3.5-flash', 'primary', 'Gemini 3.5 Flash', 1, 1, 1, 1, 0, 1, 'medium', 1048576, 8192, 0.075, 0.01875, 0.30, 45000, 1),
  ('cat_gemini_37_flash', 'gemini-3.7-flash', 'google', 'gemini_api', 'gemini-3.7-flash', 'frontier', 'Gemini 3.7 Flash', 1, 1, 1, 1, 1, 1, 'medium', 1048576, 8192, 0.10, 0.025, 0.40, 60000, 1),
  ('cat_gemini_35_pro', 'gemini-3.5-pro', 'google', 'gemini_api', 'gemini-3.5-pro', 'reasoning', 'Gemini 3.5 Pro', 1, 1, 1, 1, 1, 1, 'high', 2097152, 8192, 1.25, 0.3125, 5.00, 90000, 1),
  ('cat_antigravity_0526', 'antigravity-preview-05-2026', 'google', 'perseus', 'antigravity-preview-05-2026', 'frontier', 'Antigravity Agent (Managed)', 1, 1, 1, 1, 1, 1, 'high', 1048576, 16384, 1.50, 0.375, 6.00, 120000, 1),
  ('cat_gpt_4o', 'gpt-4o', 'openai', 'openai_api', 'gpt-4o', 'frontier', 'GPT-4o', 1, 1, 1, 1, 0, 1, 'medium', 128000, 4096, 2.50, 1.25, 10.00, 60000, 1),
  ('cat_gpt_4o_mini', 'gpt-4o-mini', 'openai', 'openai_api', 'gpt-4o-mini', 'economy', 'GPT-4o Mini', 1, 1, 1, 1, 0, 1, 'low', 128000, 4096, 0.15, 0.075, 0.60, 30000, 1),
  ('cat_claude_37_sonnet', 'claude-3-7-sonnet-20250219', 'anthropic', 'anthropic_api', 'claude-3-7-sonnet-20250219', 'reasoning', 'Claude 3.7 Sonnet', 1, 1, 1, 1, 1, 1, 'high', 200000, 8192, 3.00, 0.75, 15.00, 90000, 1),
  ('cat_workers_ai_llama3', '@cf/meta/llama-3.1-8b-instruct', 'workers_ai', 'workers_ai', '@cf/meta/llama-3.1-8b-instruct', 'local', 'Llama 3.1 8B (Workers AI)', 1, 0, 1, 1, 0, 0, 'low', 128000, 4096, 0.05, 0.0, 0.10, 20000, 1);

-- 8. Seed Default Routing Arms
INSERT OR REPLACE INTO agentsam_routing_arms (
  id, arm_key, task_type, mode, provider, model_key, alpha, beta, is_active, priority
) VALUES 
  ('arm_code_gemini_flash', 'arm:code:gemini-3.5-flash', 'code', '*', 'google', 'gemini-3.5-flash', 12.0, 1.0, 1, 100),
  ('arm_code_gemini_pro', 'arm:code:gemini-3.5-pro', 'code', '*', 'google', 'gemini-3.5-pro', 15.0, 1.0, 1, 95),
  ('arm_research_gemini_pro', 'arm:research:gemini-3.5-pro', 'research', '*', 'google', 'gemini-3.5-pro', 18.0, 1.0, 1, 100),
  ('arm_general_gemini_flash', 'arm:general:gemini-3.5-flash', 'general', '*', 'google', 'gemini-3.5-flash', 20.0, 1.0, 1, 100),
  ('arm_agent_antigravity', 'arm:agent:antigravity-preview-05-2026', 'general', 'agent', 'google', 'antigravity-preview-05-2026', 25.0, 1.0, 1, 110);

-- 9. Seed Initial Health States
INSERT OR REPLACE INTO agentsam_model_health (
  id, model_key, provider, health_status, consecutive_failures
) VALUES 
  ('hlth_gemini_35_flash', 'gemini-3.5-flash', 'google', 'healthy', 0),
  ('hlth_gemini_37_flash', 'gemini-3.7-flash', 'google', 'healthy', 0),
  ('hlth_gemini_35_pro', 'gemini-3.5-pro', 'google', 'healthy', 0),
  ('hlth_antigravity_0526', 'antigravity-preview-05-2026', 'google', 'healthy', 0),
  ('hlth_gpt_4o', 'gpt-4o', 'openai', 'healthy', 0),
  ('hlth_gpt_4o_mini', 'gpt-4o-mini', 'openai', 'healthy', 0),
  ('hlth_claude_37_sonnet', 'claude-3-7-sonnet-20250219', 'anthropic', 'healthy', 0),
  ('hlth_workers_ai_llama3', '@cf/meta/llama-3.1-8b-instruct', 'workers_ai', 'healthy', 0);

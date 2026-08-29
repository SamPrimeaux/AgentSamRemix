-- ============================================================================
-- AgentSam Cloudflare D1 / SQLite Migrations
-- Version: 0001_agentsam_core_ddl.sql
-- Description: Core schema for AgentSamFast Model Routing Memory, Eval Observations,
--              Gate Runs, Knowledge Objects, Memory Outbox, Thompson Reward Events,
--              ETO Performance Events, RAG Intent Routes, and Tool Stats.
-- ============================================================================

-- Supporting Base Tables for Foreign Keys
CREATE TABLE IF NOT EXISTS agentsam_workspace (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS agentsam_model_catalog (
  id TEXT PRIMARY KEY,
  model_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  api_platform TEXT NOT NULL DEFAULT 'standard',
  provider_model_id TEXT NOT NULL DEFAULT '',
  routing_lane TEXT NOT NULL DEFAULT 'primary',
  display_name TEXT NOT NULL,
  supports_tools INTEGER NOT NULL DEFAULT 1,
  supports_vision INTEGER NOT NULL DEFAULT 0,
  supports_json_mode INTEGER NOT NULL DEFAULT 1,
  supports_streaming INTEGER NOT NULL DEFAULT 1,
  supports_reasoning INTEGER NOT NULL DEFAULT 0,
  supports_code_execution INTEGER NOT NULL DEFAULT 1,
  reasoning_effort TEXT DEFAULT 'medium',
  context_window INTEGER DEFAULT 128000,
  max_output_tokens INTEGER DEFAULT 8192,
  cost_per_input_token REAL DEFAULT 0,
  cost_per_output_token REAL DEFAULT 0,
  input_price_per_1m REAL DEFAULT 0.0,
  cached_input_price_per_1m REAL DEFAULT 0.0,
  output_price_per_1m REAL DEFAULT 0.0,
  timeout_ms INTEGER DEFAULT 60000,
  is_active INTEGER NOT NULL DEFAULT 1,
  budget_exhausted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS agentsam_routing_arms (
  id TEXT PRIMARY KEY,
  arm_key TEXT NOT NULL UNIQUE,
  task_type TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT '*',
  provider TEXT NOT NULL,
  model_key TEXT NOT NULL,
  alpha REAL NOT NULL DEFAULT 1.0,
  beta REAL NOT NULL DEFAULT 1.0,
  pull_count INTEGER NOT NULL DEFAULT 0,
  avg_reward REAL NOT NULL DEFAULT 0.0,
  config_json TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1,
  is_paused INTEGER NOT NULL DEFAULT 0,
  is_ineligible INTEGER NOT NULL DEFAULT 0,
  budget_exhausted INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS agentsam_mcp_workflows (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  workspace_id TEXT,
  workflow_key TEXT NOT NULL,
  title TEXT NOT NULL,
  definition_json TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS agentsam_knowledge_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  workspace_id TEXT,
  target_type TEXT NOT NULL,
  target_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 1. Model Routing Memory (Thompson Routing & Aggregate Performance)
CREATE TABLE IF NOT EXISTS agentsam_model_routing_memory (
  id TEXT PRIMARY KEY DEFAULT ('mrm_' || lower(hex(randomblob(8)))),
  workspace_id TEXT,
  tenant_id TEXT,
  task_type TEXT NOT NULL,
  subtask_type TEXT,
  provider TEXT NOT NULL,
  model_key TEXT NOT NULL,
  avg_latency_ms REAL,
  avg_input_tokens REAL,
  avg_output_tokens REAL,
  avg_cost_usd REAL,
  success_rate REAL DEFAULT 0,
  retry_rate REAL DEFAULT 0,
  hallucination_rate REAL DEFAULT 0,
  tool_success_rate REAL DEFAULT 0,
  code_pass_rate REAL DEFAULT 0,
  browser_success_rate REAL DEFAULT 0,
  image_generation_score REAL DEFAULT 0,
  writing_quality_score REAL DEFAULT 0,
  reasoning_quality_score REAL DEFAULT 0,
  sample_count INTEGER DEFAULT 0,
  last_evaluated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sample_n INTEGER DEFAULT 0,
  UNIQUE(task_type, model_key, workspace_id)
);

-- 2. Model Evaluation Observations
CREATE TABLE IF NOT EXISTS agentsam_model_eval_observations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  tenant_id TEXT,
  workspace_id TEXT,
  user_id TEXT,
  provider TEXT NOT NULL,
  model_key TEXT NOT NULL,
  task_key TEXT NOT NULL,
  profile_slug TEXT,
  route_key TEXT,
  passed INTEGER NOT NULL,
  status TEXT NOT NULL,
  failure_class TEXT,
  error_message TEXT,
  latency_ms INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  estimated_cost_usd REAL NOT NULL,
  response_id TEXT,
  output_chars INTEGER NOT NULL,
  output_sha256 TEXT,
  expected_markers_found INTEGER NOT NULL,
  expected_markers_total INTEGER NOT NULL,
  artifact_path TEXT,
  raw_response_path TEXT,
  file_locations_json TEXT,
  updated_at INTEGER
);

-- 3. Gate Runs
CREATE TABLE IF NOT EXISTS agentsam_gate_runs (
  id TEXT PRIMARY KEY,
  gate_key TEXT NOT NULL,
  ticket_id TEXT,
  git_sha TEXT,
  ok INTEGER NOT NULL DEFAULT 0,
  rounds_json TEXT,
  receipt_path TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 4. Hooks
CREATE TABLE IF NOT EXISTS agentsam_hook (
  id            TEXT    PRIMARY KEY,
  tenant_id     TEXT,
  workspace_id  TEXT,
  user_id       TEXT    NOT NULL,
  provider      TEXT    NOT NULL DEFAULT 'system',
  external_id   TEXT,
  trigger       TEXT    NOT NULL
                        CHECK(trigger IN ('start','stop','pre_deploy','post_deploy',
                                          'pre_commit','error','imessage_reply','email_reply')),
  command       TEXT    NOT NULL DEFAULT '',
  target_id     TEXT    NOT NULL DEFAULT '',
  metadata      TEXT    DEFAULT '{}',
  is_active     INTEGER NOT NULL DEFAULT 1,
  run_count     INTEGER DEFAULT 0,
  last_run_at   TEXT,
  workflow_id   TEXT    REFERENCES agentsam_mcp_workflows(id) ON DELETE SET NULL,
  subagent_slug TEXT,
  person_uuid   TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  event_type    TEXT,
  hook_key      TEXT,
  handler_type  TEXT    DEFAULT 'log_only',
  handler_config TEXT   DEFAULT '{}',
  priority      INTEGER DEFAULT 100,
  updated_at    TEXT
);

-- 5. Knowledge Objects
CREATE TABLE IF NOT EXISTS agentsam_knowledge_objects (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  tenant_id TEXT,
  workspace_id TEXT NOT NULL,
  parent_object_id TEXT,
  root_object_id TEXT,
  source_snapshot_id TEXT NOT NULL,
  family TEXT NOT NULL DEFAULT 'document'
    CHECK (family IN ('document','visual','tabular','conversational','temporal','technical')),
  object_type TEXT,
  media_type TEXT,
  title TEXT,
  source_hash TEXT,
  source_size_bytes INTEGER,
  source_locator_json TEXT,
  adapter_id TEXT,
  adapter_version TEXT,
  canonical_schema_version TEXT,
  manifest_r2_key TEXT,
  artifact_prefix TEXT,
  acl_ref TEXT,
  security_label TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending','extracting','projecting','completed','partial','failed','cancelled','quarantined'
    )),
  ordinal INTEGER NOT NULL DEFAULT 0,
  child_count INTEGER NOT NULL DEFAULT 0,
  unit_count INTEGER NOT NULL DEFAULT 0,
  segment_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (run_id) REFERENCES agentsam_knowledge_runs(id)
);

-- 6. Durable Memory System
CREATE TABLE IF NOT EXISTS agentsam_memory (
  id               TEXT    PRIMARY KEY,
  memory_id        TEXT    NOT NULL,
  tenant_id        TEXT    NOT NULL,
  user_id          TEXT    NOT NULL,
  workspace_id     TEXT,
  scope_type       TEXT    NOT NULL DEFAULT 'user'
                           CHECK (scope_type IN ('user','workspace','tenant','platform')),
  scope_id         TEXT,
  memory_type      TEXT    DEFAULT 'fact'
                           CHECK (memory_type IN (
                             'fact','preference','decision','policy','state','procedure','event','error',
                             'project','skill'
                           )),
  key              TEXT    NOT NULL,
  value            TEXT    NOT NULL,
  title            TEXT,
  summary          TEXT,
  source           TEXT,
  source_type      TEXT,
  source_ref       TEXT,
  confidence       REAL    DEFAULT 1.0,
  decay_score      REAL    DEFAULT 1.0,
  recall_count     INTEGER DEFAULT 0,
  last_recalled_at INTEGER,
  expires_at       INTEGER,
  importance       INTEGER DEFAULT 5,
  is_pinned        INTEGER DEFAULT 0,
  is_archived      INTEGER DEFAULT 0,
  sync_key         TEXT,
  created_at       INTEGER DEFAULT (unixepoch()),
  updated_at       INTEGER DEFAULT (unixepoch()),
  agent_id         TEXT,
  session_id       TEXT,
  tags             TEXT    DEFAULT '[]',
  embedding_id     TEXT,
  plan_id          TEXT,
  task_id          TEXT,
  embedded_at      INTEGER,
  is_resolved      INTEGER DEFAULT 0,
  resolved_at      INTEGER,
  resolved_by      TEXT,
  revision         INTEGER NOT NULL DEFAULT 1,
  status           TEXT    NOT NULL DEFAULT 'active'
                           CHECK (status IN ('candidate','active','superseded','archived','deleted')),
  content_hash     TEXT,
  sensitivity      TEXT    NOT NULL DEFAULT 'normal'
                           CHECK (sensitivity IN ('normal','internal','confidential','secret')),
  value_json       TEXT,
  supersedes_id    TEXT,
  superseded_by_id TEXT,
  projection_status TEXT   NOT NULL DEFAULT 'pending'
                           CHECK (projection_status IN ('pending','processing','ready','partial','failed','skipped')),
  projection_version INTEGER NOT NULL DEFAULT 0,
  projection_attempts INTEGER NOT NULL DEFAULT 0,
  last_projection_error TEXT,
  idempotency_key  TEXT,
  UNIQUE(memory_id, revision)
);

-- 7. Memory Outbox (Projections for Vectorize, Managed PG, PGVector)
CREATE TABLE IF NOT EXISTS agentsam_memory_outbox (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert','delete','tombstone')),
  desired_projections_json TEXT NOT NULL DEFAULT '["managed_pg","pgvector_chunk","vectorize"]',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','partial','completed','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  locked_at INTEGER,
  last_error TEXT,
  receipts_json TEXT NOT NULL DEFAULT '{}',
  tenant_id TEXT,
  user_id TEXT,
  workspace_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 8. Reward Events (Thompson Sampling Signals)
CREATE TABLE IF NOT EXISTS agentsam_reward_events (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  task_type        TEXT NOT NULL,
  agent_run_id     TEXT,
  tool_call_log_id TEXT,
  routing_arm_id   TEXT,
  model_key        TEXT,
  provider         TEXT,
  content_tier     TEXT,
  signal_type      TEXT NOT NULL,
  signal_source    TEXT NOT NULL DEFAULT 'user',
  signal_value     REAL NOT NULL DEFAULT 0,
  alpha_delta      REAL NOT NULL DEFAULT 0,
  beta_delta       REAL NOT NULL DEFAULT 0,
  cost_usd         REAL,
  latency_ms       INTEGER,
  reason           TEXT,
  metadata_json    TEXT NOT NULL DEFAULT '{}',
  dedup_key        TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  created_at_unix  INTEGER NOT NULL DEFAULT (unixepoch()),
  failure_category TEXT,
  tool_chain_id    TEXT,
  source_table     TEXT,
  source_id        TEXT,
  eto_event_id     TEXT,
  experience_id    TEXT,
  evidence_class   TEXT,
  reward_type      TEXT,
  reward_score     REAL,
  reward_weight    REAL,
  evidence_count   INTEGER,
  bandit_eligible  INTEGER,
  policy_version   TEXT,
  skip_reason      TEXT,
  failure_origin   TEXT,
  failure_code     TEXT,
  writer_key       TEXT,
  applied_at_unix  INTEGER
);

-- 9. Performance ETO Events
CREATE TABLE IF NOT EXISTS agentsam_performance_eto_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT '',
  workspace_id TEXT NOT NULL DEFAULT '',
  user_id TEXT,
  source_table TEXT NOT NULL CHECK (source_table IN (
    'agentsam_agent_run',
    'agentsam_usage_events',
    'agentsam_command_run',
    'agentsam_workflow_runs',
    'agentsam_execution_steps',
    'agentsam_executions',
    'agentsam_tool_call_log',
    'agentsam_mcp_tool_execution',
    'agentsam_eval_runs',
    'agentsam_escalation'
  )),
  source_id TEXT NOT NULL,
  agent_run_id TEXT,
  workflow_run_id TEXT,
  execution_id TEXT,
  execution_step_id TEXT,
  command_run_id TEXT,
  tool_call_id TEXT,
  mcp_tool_execution_id TEXT,
  eval_run_id TEXT,
  usage_event_id TEXT,
  epm_id TEXT,
  routing_arm_id TEXT,
  inferred_routing_arm_id TEXT,
  route_key TEXT,
  task_type TEXT,
  mode TEXT,
  model_catalog_id TEXT,
  model_key TEXT,
  provider TEXT,
  event_status TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  failure INTEGER NOT NULL DEFAULT 0,
  timed_out INTEGER NOT NULL DEFAULT 0,
  sla_breach INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  quality_score REAL,
  is_smoke_test INTEGER NOT NULL DEFAULT 0,
  is_training_eligible INTEGER NOT NULL DEFAULT 0,
  reward_score REAL NOT NULL DEFAULT 0,
  alpha_delta REAL NOT NULL DEFAULT 0,
  beta_delta REAL NOT NULL DEFAULT 0,
  reward_reason TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  etl_run_id TEXT,
  eto_run_id TEXT,
  applied_to_thompson_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at_unix INTEGER,
  UNIQUE(source_table, source_id),
  FOREIGN KEY (routing_arm_id) REFERENCES agentsam_routing_arms(id) ON DELETE SET NULL,
  FOREIGN KEY (inferred_routing_arm_id) REFERENCES agentsam_routing_arms(id) ON DELETE SET NULL,
  FOREIGN KEY (model_catalog_id) REFERENCES agentsam_model_catalog(id) ON DELETE SET NULL,
  FOREIGN KEY (workspace_id) REFERENCES agentsam_workspace(id) ON DELETE SET NULL
);

-- 10. RAG Intent Routes
CREATE TABLE IF NOT EXISTS agentsam_rag_intent_routes (
  id TEXT PRIMARY KEY,
  intent_key TEXT NOT NULL UNIQUE,
  lane_order_json TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 11. Compacted Tool Stats
CREATE TABLE IF NOT EXISTS agentsam_tool_stats_compacted (
  id TEXT PRIMARY KEY DEFAULT ('atsc_' || lower(hex(randomblob(8)))),
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT '',
  metric_date TEXT NOT NULL,
  source_client TEXT NOT NULL DEFAULT 'unknown',
  cost_basis TEXT NOT NULL DEFAULT 'unknown'
    CHECK (cost_basis IN ('api_metered', 'external_subscription', 'unknown')),
  model_key TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT '',
  tool_key TEXT NOT NULL,
  tool_category TEXT,
  call_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  timeout_count INTEGER NOT NULL DEFAULT 0,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  duration_sum_ms INTEGER NOT NULL DEFAULT 0,
  duration_min_ms INTEGER,
  duration_max_ms INTEGER,
  p50_duration_ms INTEGER,
  p95_duration_ms INTEGER,
  success_duration_sum_ms INTEGER NOT NULL DEFAULT 0,
  attributed_model_cost_usd REAL NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_attributed_call_count INTEGER NOT NULL DEFAULT 0,
  token_attributed_call_count INTEGER NOT NULL DEFAULT 0,
  conversation_count INTEGER NOT NULL DEFAULT 0,
  run_count INTEGER NOT NULL DEFAULT 0,
  computed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (tenant_id, workspace_id, metric_date, source_client, model_key, mode, tool_key)
);

-- Indexes for high throughput edge querying
CREATE INDEX IF NOT EXISTS idx_mrm_task_model ON agentsam_model_routing_memory(task_type, model_key);
CREATE INDEX IF NOT EXISTS idx_eval_obs_run ON agentsam_model_eval_observations(run_id);
CREATE INDEX IF NOT EXISTS idx_eval_obs_model ON agentsam_model_eval_observations(model_key);
CREATE INDEX IF NOT EXISTS idx_memory_user ON agentsam_memory(user_id, scope_type);
CREATE INDEX IF NOT EXISTS idx_memory_key ON agentsam_memory(key);
CREATE INDEX IF NOT EXISTS idx_reward_events_task ON agentsam_reward_events(task_type, routing_arm_id);
CREATE INDEX IF NOT EXISTS idx_eto_events_model ON agentsam_performance_eto_events(model_key, task_type);
CREATE INDEX IF NOT EXISTS idx_tool_stats_date ON agentsam_tool_stats_compacted(metric_date, tool_key);

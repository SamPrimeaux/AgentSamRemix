-- ============================================================================
-- AgentSam Cloudflare D1 / SQLite Migrations
-- Version: 0005_agentsam_ml_policy_observations.sql
-- Description: Canonical ML Observations Dataset, Logged Policy Decisions with
--              Selection Propensity (p_i), Contextual Bandit State, & Model Artifacts.
-- ============================================================================

-- 1. Canonical Training Observations Ledger
CREATE TABLE IF NOT EXISTS agentsam_ml_observations (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT 'default_workspace',
  tenant_id TEXT NOT NULL DEFAULT 'default_tenant',
  session_id TEXT,
  agent_run_id TEXT,
  
  -- Context
  task_type TEXT NOT NULL, -- 'code', 'research', 'dossier', 'chat', 'financial_synthesis', 'general'
  mode TEXT NOT NULL DEFAULT 'agent', -- 'ask', 'agent', 'background', 'batch'
  route_key TEXT,
  prompt_length INTEGER NOT NULL DEFAULT 0,
  estimated_tokens INTEGER NOT NULL DEFAULT 0,
  tool_required INTEGER NOT NULL DEFAULT 0,
  tools_requested_count INTEGER NOT NULL DEFAULT 0,
  repo_present INTEGER NOT NULL DEFAULT 0,
  repo_files_count INTEGER NOT NULL DEFAULT 0,
  repo_language TEXT,
  recent_failure_rate REAL NOT NULL DEFAULT 0.0,
  execution_lane TEXT NOT NULL DEFAULT 'local', -- 'local', 'gcp', 'sandbox'
  context_features_json TEXT NOT NULL DEFAULT '{}',
  
  -- Action Chosen
  model_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  reasoning_effort TEXT DEFAULT 'medium',
  supports_tools INTEGER NOT NULL DEFAULT 1,
  selected_tools_json TEXT DEFAULT '[]',
  terminal_lane TEXT DEFAULT 'primary',
  action_features_json TEXT NOT NULL DEFAULT '{}',
  
  -- Bandit & Off-Policy Propensity Tracking
  policy_version TEXT NOT NULL DEFAULT 'policy_v1_contextual_thompson',
  feature_schema_version TEXT NOT NULL DEFAULT 'v1.0',
  selection_probability REAL NOT NULL DEFAULT 1.0, -- Propensity score p(a|x) for Inverse Propensity Weighting (IPW)
  candidate_actions_json TEXT NOT NULL DEFAULT '[]',
  predicted_success REAL,
  predicted_quality REAL,
  predicted_latency_ms REAL,
  predicted_cost_usd REAL,
  exploration_reason TEXT NOT NULL DEFAULT 'thompson_sample', -- 'greedy', 'thompson_sample', 'epsilon', 'shadow'
  model_artifact_version TEXT NOT NULL DEFAULT 'v1.0_baseline',
  
  -- Outcome (Training Target)
  success INTEGER NOT NULL DEFAULT 1, -- 1 for execution success, 0 for failure
  quality_score REAL NOT NULL DEFAULT 0.8, -- 0.0 to 1.0
  user_feedback INTEGER DEFAULT 0, -- 1 = thumbs up/starred, -1 = thumbs down, 0 = neutral/unspecified
  latency_ms INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0.0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  failure_origin TEXT, -- 'model', 'provider', 'platform', 'tool', 'user'
  failure_category TEXT,
  tool_calls_count INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  is_training_eligible INTEGER NOT NULL DEFAULT 1, -- 0 if platform failure / cancelled by user to avoid poisoning
  
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  created_at_iso TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 2. Policy Model Artifacts Store (Weights, Coefficients, and Offline Eval Metrics)
CREATE TABLE IF NOT EXISTS agentsam_policy_models (
  id TEXT PRIMARY KEY,
  model_name TEXT NOT NULL, -- e.g. 'agentsam_contextual_policy'
  version TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'candidate', 'shadow', 'archived')),
  policy_type TEXT NOT NULL DEFAULT 'contextual_linear_bandit',
  feature_schema_version TEXT NOT NULL DEFAULT 'v1.0',
  feature_dim INTEGER NOT NULL DEFAULT 24,
  weights_json TEXT NOT NULL, -- Serialized bias, weights, normalization scalers
  eval_metrics_json TEXT NOT NULL DEFAULT '{}', -- e.g. { "roc_auc": 0.89, "rmse_latency": 450, "sample_count": 1500 }
  trained_by TEXT NOT NULL DEFAULT 'system_offline_trainer',
  sample_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  activated_at INTEGER
);

-- 3. Execution Lane Performance Ledger
CREATE TABLE IF NOT EXISTS agentsam_execution_lane_stats (
  lane_key TEXT PRIMARY KEY, -- 'local_mac', 'gcp_vm', 'sandbox_isolated'
  display_name TEXT NOT NULL,
  is_available INTEGER NOT NULL DEFAULT 1,
  total_runs INTEGER NOT NULL DEFAULT 0,
  success_runs INTEGER NOT NULL DEFAULT 0,
  avg_startup_latency_ms INTEGER NOT NULL DEFAULT 0,
  avg_execution_latency_ms INTEGER NOT NULL DEFAULT 0,
  timeout_rate REAL NOT NULL DEFAULT 0.0,
  security_clearance_required TEXT NOT NULL DEFAULT 'standard',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Seed baseline lanes
INSERT OR IGNORE INTO agentsam_execution_lane_stats (lane_key, display_name, is_available, security_clearance_required)
VALUES 
  ('local_mac', 'Local Runtime / Host Container', 1, 'standard'),
  ('gcp_vm', 'Cloud Run / GCP Accelerated Node', 1, 'elevated'),
  ('sandbox_isolated', 'Sandboxed MicroVM / E2B Isolated Container', 1, 'restricted');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ml_obs_task_mode ON agentsam_ml_observations(task_type, mode);
CREATE INDEX IF NOT EXISTS idx_ml_obs_model ON agentsam_ml_observations(model_key);
CREATE INDEX IF NOT EXISTS idx_ml_obs_decision ON agentsam_ml_observations(decision_id);
CREATE INDEX IF NOT EXISTS idx_ml_obs_training ON agentsam_ml_observations(is_training_eligible, created_at);
CREATE INDEX IF NOT EXISTS idx_policy_models_status ON agentsam_policy_models(status);

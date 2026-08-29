-- ============================================================================
-- AgentSam Cloudflare D1 / SQLite Migrations
-- Version: 0007_agentsam_durable_workflows.sql
-- Description: Schema for Cloudflare Workflows durable orchestration,
--              Queue fan-out correlation, D1 control plane receipts,
--              Saga rollback compensation, approval events, and graph drift.
-- ============================================================================

-- 1. Product Workflow Definitions (Desired Graph)
CREATE TABLE IF NOT EXISTS agentsam_workflows (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  workflow_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'orchestration',
  is_active INTEGER NOT NULL DEFAULT 1,
  cron_schedule TEXT,
  step_limit INTEGER NOT NULL DEFAULT 10000,
  success_retention_days INTEGER NOT NULL DEFAULT 7,
  error_retention_days INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 2. Product Workflow Nodes
CREATE TABLE IF NOT EXISTS agentsam_workflow_nodes (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  node_key TEXT NOT NULL,
  node_type TEXT NOT NULL, -- step_do, wait_for_event, parallel, saga_step, condition, rollback
  label TEXT NOT NULL,
  handler_name TEXT,
  timeout_seconds INTEGER DEFAULT 300,
  max_retries INTEGER DEFAULT 3,
  backoff_type TEXT DEFAULT 'exponential',
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (workflow_id) REFERENCES agentsam_workflows(id) ON DELETE CASCADE
);

-- 3. Product Workflow Edges
CREATE TABLE IF NOT EXISTS agentsam_workflow_edges (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  edge_type TEXT NOT NULL DEFAULT 'success', -- success, failure, event, rollback
  condition_expr TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (workflow_id) REFERENCES agentsam_workflows(id) ON DELETE CASCADE
);

-- 4. Cloudflare Durable Workflow Execution Runs (D1 Control Plane Authority)
CREATE TABLE IF NOT EXISTS agentsam_workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT,
  runtime TEXT NOT NULL DEFAULT 'cloudflare_workflows',
  external_workflow_name TEXT NOT NULL,
  external_instance_id TEXT NOT NULL UNIQUE,
  external_version_id TEXT,
  trigger_source TEXT NOT NULL DEFAULT 'api', -- api, cron, event, queue, subworkflow
  status TEXT NOT NULL DEFAULT 'running', -- queued, running, paused, waiting_for_event, completed, failed, terminated, rolled_back
  workspace_id TEXT,
  tenant_id TEXT,
  agent_run_id TEXT,
  policy_decision_id TEXT,
  repo_snapshot_id TEXT,
  current_step_index INTEGER DEFAULT 0,
  total_steps INTEGER DEFAULT 0,
  waiting_event_name TEXT,
  params_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT,
  error_json TEXT,
  success_retention_days INTEGER DEFAULT 7,
  error_retention_days INTEGER DEFAULT 30,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT
);

-- 5. Workflow Event Buffer (waitForEvent / sendEvent)
CREATE TABLE IF NOT EXISTS agentsam_workflow_events (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, consumed, expired
  payload_json TEXT NOT NULL DEFAULT '{}',
  emitted_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  consumed_at TEXT
);

-- 6. Workflow Step Execution Logs & Full Output Inspection
CREATE TABLE IF NOT EXISTS agentsam_workflow_step_logs (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  step_name TEXT NOT NULL,
  step_index INTEGER NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL, -- running, completed, errored, skipped, rolled_back
  duration_ms INTEGER DEFAULT 0,
  input_json TEXT,
  output_json TEXT,
  error_text TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT
);

-- 7. Cloudflare Queue High-Volume Fan-Out Log
CREATE TABLE IF NOT EXISTS agentsam_queue_messages (
  id TEXT PRIMARY KEY,
  queue_name TEXT NOT NULL,
  message_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', -- queued, processing, completed, failed
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT
);

-- Indexes for rapid status & instance correlation
CREATE INDEX IF NOT EXISTS idx_wfrun_external_inst ON agentsam_workflow_runs(external_instance_id);
CREATE INDEX IF NOT EXISTS idx_wfrun_status ON agentsam_workflow_runs(status);
CREATE INDEX IF NOT EXISTS idx_wfrun_workspace ON agentsam_workflow_runs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_wfrun_agent ON agentsam_workflow_runs(agent_run_id);
CREATE INDEX IF NOT EXISTS idx_wfevents_inst ON agentsam_workflow_events(instance_id, event_name, status);
CREATE INDEX IF NOT EXISTS idx_wfsteplogs_inst ON agentsam_workflow_step_logs(instance_id, step_index, attempt);
CREATE INDEX IF NOT EXISTS idx_queue_status ON agentsam_queue_messages(queue_name, status);

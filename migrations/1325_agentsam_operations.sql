-- Generic durable-operation status ledger. Not wired to anything yet --
-- see backend/operations/repository.js for the harvest-and-adapt rationale
-- (pulled from agent/harvest-agentsamfast-gold, salvaged after the branch's
-- Cloudflare-Workflow class and its dependencies were confirmed either
-- superseded by backend/rag/ or duplicating undetermined existing
-- infrastructure -- iam-workflows' agentsam-dag-workflow, Workflow Studio,
-- MY_QUEUE).
--
-- Any operation that moves to 'waiting_for_approval' must also insert a row
-- into agentsam_approval_queue (see approval_queue_id below) so it enters
-- the existing 10-min-push / 20-min-halt sweep in
-- backend/jobs/approval-notify.js. Do not build a second notification path.

CREATE TABLE IF NOT EXISTS agentsam_operations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','waiting_for_approval','paused','completed','failed','cancelled','rolled_back')),
  trigger_source TEXT DEFAULT 'api'
    CHECK (trigger_source IN ('api','agent','cron','event','queue','cli')),
  run_id TEXT,
  idempotency_key TEXT,
  approval_queue_id TEXT REFERENCES agentsam_approval_queue(id),
  input_json TEXT,
  output_json TEXT,
  error_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_agentsam_operations_workspace_status
  ON agentsam_operations (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_agentsam_operations_idempotency
  ON agentsam_operations (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS agentsam_operation_steps (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES agentsam_operations(id),
  step_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','waiting_for_approval','completed','failed','skipped','rolled_back')),
  output_json TEXT,
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_agentsam_operation_steps_operation
  ON agentsam_operation_steps (operation_id);

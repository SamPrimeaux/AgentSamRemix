-- Retrieval V1 evaluation/control-plane observations.
-- Raw query text is intentionally not persisted; query_hash is SHA-256.
CREATE TABLE IF NOT EXISTS agentsam_retrieval_observations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  tenant_id TEXT,
  user_id TEXT,
  run_id TEXT,
  query_hash TEXT NOT NULL,
  task_type TEXT NOT NULL DEFAULT 'retrieval',
  scope_type TEXT NOT NULL DEFAULT 'workspace',
  scope_id TEXT,
  retrieval_policy_version TEXT NOT NULL,
  dense_route_key TEXT,
  embedding_space_key TEXT,
  ann_k INTEGER NOT NULL DEFAULT 0,
  dense_candidates INTEGER NOT NULL DEFAULT 0,
  lexical_candidates INTEGER NOT NULL DEFAULT 0,
  ast_candidates INTEGER NOT NULL DEFAULT 0,
  fused_candidates INTEGER NOT NULL DEFAULT 0,
  reranked_candidates INTEGER NOT NULL DEFAULT 0,
  selected_chunks INTEGER NOT NULL DEFAULT 0,
  selected_tokens INTEGER NOT NULL DEFAULT 0,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_retrieval_obs_workspace_time
  ON agentsam_retrieval_observations(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_retrieval_obs_policy_time
  ON agentsam_retrieval_observations(retrieval_policy_version, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_retrieval_obs_query_hash
  ON agentsam_retrieval_observations(query_hash, created_at DESC);

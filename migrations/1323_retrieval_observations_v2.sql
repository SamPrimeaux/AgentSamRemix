-- Retrieval V1 closure: observations are policy/evaluation data, not identity state.
-- Workspace remains a physical authorization/index partition elsewhere, but is not
-- persisted here as a learning dimension. Preserve existing rows as legacy corpus
-- observations so rollout does not discard already-collected evaluation history.

CREATE TABLE agentsam_retrieval_observations_v2 (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  decision_id TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  task_type TEXT NOT NULL DEFAULT 'retrieval',
  corpus_type TEXT NOT NULL DEFAULT 'code_index',
  corpus_key TEXT NOT NULL,
  repo_full_name TEXT,
  index_generation_key TEXT,
  revision_sha TEXT,
  retrieval_policy_version TEXT NOT NULL,
  dense_route_key TEXT,
  embedding_space_key TEXT,
  ann_k INTEGER NOT NULL DEFAULT 0,
  dense_candidates INTEGER NOT NULL DEFAULT 0,
  lexical_candidates INTEGER NOT NULL DEFAULT 0,
  ast_candidates INTEGER NOT NULL DEFAULT 0,
  graph_candidates INTEGER NOT NULL DEFAULT 0,
  fused_candidates INTEGER NOT NULL DEFAULT 0,
  reranked_candidates INTEGER NOT NULL DEFAULT 0,
  selected_chunks INTEGER NOT NULL DEFAULT 0,
  selected_tokens INTEGER NOT NULL DEFAULT 0,
  total_retrieval_ms REAL,
  rerank_ms REAL,
  packing_ms REAL,
  fusion_score_margin REAL,
  fusion_score_entropy REAL,
  redundant_token_ratio REAL,
  budget_utilization REAL,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT OR IGNORE INTO agentsam_retrieval_observations_v2 (
  id, run_id, decision_id, query_hash, task_type,
  corpus_type, corpus_key, repo_full_name,
  retrieval_policy_version, dense_route_key, embedding_space_key, ann_k,
  dense_candidates, lexical_candidates, ast_candidates, graph_candidates,
  fused_candidates, reranked_candidates, selected_chunks, selected_tokens,
  metrics_json, created_at
)
SELECT
  id,
  run_id,
  'legacy:' || id,
  query_hash,
  task_type,
  CASE WHEN scope_type = 'repo' THEN 'code_repo' ELSE 'legacy_scope' END,
  CASE
    WHEN scope_id IS NOT NULL AND TRIM(scope_id) <> '' THEN scope_type || ':' || scope_id
    ELSE 'legacy:' || id
  END,
  CASE WHEN scope_type = 'repo' THEN scope_id ELSE NULL END,
  retrieval_policy_version,
  dense_route_key,
  embedding_space_key,
  ann_k,
  dense_candidates,
  lexical_candidates,
  ast_candidates,
  0,
  fused_candidates,
  reranked_candidates,
  selected_chunks,
  selected_tokens,
  metrics_json,
  created_at
FROM agentsam_retrieval_observations;

DROP INDEX IF EXISTS idx_retrieval_obs_workspace_time;
DROP INDEX IF EXISTS idx_retrieval_obs_policy_time;
DROP INDEX IF EXISTS idx_retrieval_obs_query_hash;
DROP TABLE agentsam_retrieval_observations;
ALTER TABLE agentsam_retrieval_observations_v2 RENAME TO agentsam_retrieval_observations;

CREATE INDEX idx_retrieval_obs_run_time
  ON agentsam_retrieval_observations(run_id, created_at DESC);
CREATE INDEX idx_retrieval_obs_corpus_time
  ON agentsam_retrieval_observations(corpus_key, created_at DESC);
CREATE INDEX idx_retrieval_obs_policy_time
  ON agentsam_retrieval_observations(retrieval_policy_version, created_at DESC);
CREATE INDEX idx_retrieval_obs_query_hash
  ON agentsam_retrieval_observations(query_hash, created_at DESC);
CREATE INDEX idx_retrieval_obs_decision
  ON agentsam_retrieval_observations(decision_id);

-- ============================================================================
-- AgentSam Cloudflare D1 / SQLite Migrations
-- Version: 0006_agentsam_ml_hardening_and_repo_intelligence.sql
-- Description: Repo Intelligence Snapshots, Embedding Routes Control Plane,
--              Shadow Decisions Logging & Model Promotion State Machine.
-- ============================================================================

-- 1. Repo Intelligence & Engineering Velocity Snapshots
CREATE TABLE IF NOT EXISTS agentsam_repo_intelligence_snapshots (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL DEFAULT 'default_repo',
  revision TEXT NOT NULL,
  captured_at INTEGER NOT NULL DEFAULT (unixepoch()),
  captured_at_iso TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  
  -- Size & Scale
  file_count INTEGER NOT NULL DEFAULT 0,
  code_lines INTEGER NOT NULL DEFAULT 0,
  
  -- Churn & Rewrite Metrics
  recent_churn INTEGER NOT NULL DEFAULT 0,
  baseline_churn INTEGER NOT NULL DEFAULT 0,
  activity_ratio REAL NOT NULL DEFAULT 1.0,
  rewrite_balance REAL NOT NULL DEFAULT 0.0, -- 2 * min(additions, deletions) / total_churn
  
  -- Pressure & Stabilization
  hotspot_count INTEGER NOT NULL DEFAULT 0,
  severe_hotspot_count INTEGER NOT NULL DEFAULT 0,
  stabilizing_count INTEGER NOT NULL DEFAULT 0,
  accelerating_count INTEGER NOT NULL DEFAULT 0,
  
  -- Architecture Coupling & Blast Radius
  cross_domain_coupling REAL NOT NULL DEFAULT 0.0,
  change_amplification REAL NOT NULL DEFAULT 1.0, -- median files per commit
  coordination_tax REAL NOT NULL DEFAULT 0.0,
  migration_completion_score REAL NOT NULL DEFAULT 1.0, -- 0.0 to 1.0
  
  -- Delivery & Velocity
  merged_changes_7d INTEGER NOT NULL DEFAULT 0,
  green_merge_rate REAL NOT NULL DEFAULT 1.0,
  
  -- Payloads & Versioning
  packet_json TEXT NOT NULL DEFAULT '{}',
  packet_hash TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT 'v1.0'
);

-- 2. Embedding Routes Control Plane Registry
CREATE TABLE IF NOT EXISTS agentsam_embedding_routes (
  id TEXT PRIMARY KEY,
  route_key TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('codebase', 'memory', 'documents', 'schema', 'archive', 'media')),
  
  provider TEXT NOT NULL, -- 'google', 'openai', 'workers_ai', 'local', 'ollama'
  model_key TEXT NOT NULL,
  model_catalog_id TEXT,
  
  dimensions INTEGER NOT NULL CHECK (dimensions IN (384, 512, 768, 1024, 1536, 3072)),
  metric TEXT NOT NULL DEFAULT 'cosine' CHECK (metric IN ('cosine', 'euclidean', 'dot')),
  pooling TEXT NOT NULL DEFAULT 'mean',
  
  embedding_space_key TEXT NOT NULL, -- e.g. 'workers_ai:@cf/baai/bge-base-en-v1.5:768:mean:v1'
  embedding_version TEXT NOT NULL DEFAULT 'v1',
  
  vector_store TEXT NOT NULL DEFAULT 'd1_sqlite' CHECK (vector_store IN ('d1_sqlite', 'pgvector', 'vectorize', 'hybrid')),
  schema_name TEXT,
  table_name TEXT,
  vectorize_binding TEXT,
  vectorize_index TEXT,
  
  is_active INTEGER NOT NULL DEFAULT 1,
  is_preferred INTEGER NOT NULL DEFAULT 0,
  is_archive INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 100,
  
  health_status TEXT NOT NULL DEFAULT 'healthy' CHECK (health_status IN ('healthy', 'degraded', 'unavailable')),
  budget_status TEXT NOT NULL DEFAULT 'available' CHECK (budget_status IN ('available', 'constrained', 'exhausted')),
  cost_per_million_tokens REAL NOT NULL DEFAULT 0.02,
  
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 3. Shadow Decisions & OPE Telemetry Extension in ML Observations
-- (Add shadow policy columns to agentsam_ml_observations)
-- Note: SQLite supports ADD COLUMN IF NOT EXISTS or safe alter commands
CREATE INDEX IF NOT EXISTS idx_repo_snapshots_repo ON agentsam_repo_intelligence_snapshots(repo_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_embedding_routes_purpose ON agentsam_embedding_routes(purpose, is_active, is_preferred);
CREATE INDEX IF NOT EXISTS idx_embedding_routes_space ON agentsam_embedding_routes(embedding_space_key);

-- Seed Default Embedding Routes in D1
INSERT OR IGNORE INTO agentsam_embedding_routes (
  id, route_key, purpose, provider, model_key, dimensions, metric, pooling,
  embedding_space_key, embedding_version, vector_store, is_active, is_preferred, cost_per_million_tokens
) VALUES 
  (
    'route_google_code_768',
    'code:google-text-embed:v1',
    'codebase',
    'google',
    'text-embedding-004',
    768,
    'cosine',
    'mean',
    'google:text-embedding-004:768:mean:v1',
    'v1',
    'd1_sqlite',
    1,
    1,
    0.08
  ),
  (
    'route_workers_bge_768',
    'code:workers-bge-base:v1',
    'codebase',
    'workers_ai',
    '@cf/baai/bge-base-en-v1.5',
    768,
    'cosine',
    'mean',
    'workers_ai:@cf/baai/bge-base-en-v1.5:768:mean:v1',
    'v1',
    'd1_sqlite',
    1,
    0,
    0.011
  ),
  (
    'route_openai_embed_1536',
    'docs:openai-embed-3:v1',
    'documents',
    'openai',
    'text-embedding-3-small',
    1536,
    'cosine',
    'mean',
    'openai:text-embedding-3-small:1536:mean:v1',
    'v1',
    'd1_sqlite',
    1,
    0,
    0.02
  );

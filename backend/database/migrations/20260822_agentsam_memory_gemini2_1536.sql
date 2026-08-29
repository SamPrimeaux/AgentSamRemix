-- Agent Sam Gemini Embedding 2 semantic memory (pgvector).
-- Schema: agentsam (never public.agentsam_*).
-- Dimensions: 1536. Model: gemini-embedding-2.
--
-- This is NOT agentsam.agentsam_memory (operational KV/facts).
-- This is NOT agentsam.agentsam_memory_oai3large_1536 (OpenAI vector space).
-- Vectorize, if added later, must remain a rebuildable projection of this table.
--
-- Time columns are INTEGER unixepoch seconds. Filter on *_unix only.

BEGIN;

CREATE SCHEMA IF NOT EXISTS agentsam;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS agentsam.agentsam_memory_gemini2_1536 (
  id TEXT PRIMARY KEY,

  workspace_id TEXT NOT NULL,
  subject_id TEXT NULL,
  agent_id TEXT NULL,
  tenant_id TEXT NULL,

  memory_type TEXT NOT NULL DEFAULT 'fact',
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,

  embedding vector(1536) NOT NULL,
  embedding_model TEXT NOT NULL DEFAULT 'gemini-embedding-2',
  embedding_dimensions INTEGER NOT NULL DEFAULT 1536,

  importance REAL NOT NULL DEFAULT 0.5
    CHECK (importance >= 0 AND importance <= 1),
  confidence REAL NOT NULL DEFAULT 0.75
    CHECK (confidence >= 0 AND confidence <= 1),

  source_type TEXT NULL,
  source_id TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  supersedes_id TEXT NULL,
  superseded_by_id TEXT NULL,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at_unix INTEGER NULL,
  created_at_unix INTEGER NOT NULL,
  updated_at_unix INTEGER NOT NULL,
  embedded_at_unix INTEGER NOT NULL,

  CHECK (length(trim(content)) > 0),
  CHECK (embedding_dimensions = 1536),
  CHECK (expires_at_unix IS NULL OR expires_at_unix > 0),
  CHECK (created_at_unix > 0),
  CHECK (updated_at_unix > 0),
  CHECK (embedded_at_unix > 0)
);

CREATE INDEX IF NOT EXISTS agentsam_memory_gemini2_embedding_hnsw_idx
  ON agentsam.agentsam_memory_gemini2_1536
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS agentsam_memory_gemini2_workspace_active_idx
  ON agentsam.agentsam_memory_gemini2_1536 (workspace_id, is_active, updated_at_unix DESC);

CREATE INDEX IF NOT EXISTS agentsam_memory_gemini2_workspace_subject_idx
  ON agentsam.agentsam_memory_gemini2_1536 (workspace_id, subject_id, is_active, updated_at_unix DESC)
  WHERE subject_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS agentsam_memory_gemini2_workspace_type_idx
  ON agentsam.agentsam_memory_gemini2_1536 (workspace_id, memory_type, is_active, updated_at_unix DESC);

CREATE INDEX IF NOT EXISTS agentsam_memory_gemini2_content_hash_idx
  ON agentsam.agentsam_memory_gemini2_1536 (workspace_id, content_hash);

CREATE INDEX IF NOT EXISTS agentsam_memory_gemini2_expiry_idx
  ON agentsam.agentsam_memory_gemini2_1536 (expires_at_unix)
  WHERE expires_at_unix IS NOT NULL AND is_active = TRUE;

ALTER TABLE agentsam.agentsam_memory_gemini2_1536 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE agentsam.agentsam_memory_gemini2_1536 FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA agentsam TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON agentsam.agentsam_memory_gemini2_1536 TO service_role;

COMMENT ON TABLE agentsam.agentsam_memory_gemini2_1536 IS
  'Canonical Gemini Embedding 2 semantic memory. Operational facts remain in agentsam.agentsam_memory. Vectorize must stay a rebuildable projection.';

COMMENT ON COLUMN agentsam.agentsam_memory_gemini2_1536.embedding IS
  'gemini-embedding-2, 1536 dimensions, cosine HNSW. Do not mix with oai3large vectors.';

COMMENT ON COLUMN agentsam.agentsam_memory_gemini2_1536.is_active IS
  'Actively flipped by forget()/supersede(). Expiry is computed from expires_at_unix at read time.';

COMMIT;

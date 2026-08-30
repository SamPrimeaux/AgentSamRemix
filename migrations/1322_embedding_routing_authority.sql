-- Make embedding model selection database-authoritative.
-- Runtime order: routing arm -> model catalog -> matching pgvector lane -> provider adapter.
-- This migration is idempotent and mirrors the production repair applied 2026-08-30.

UPDATE agentsam_pgvector_lane_registry
SET embedding_model = 'gemini-embedding-2',
    updated_at = datetime('now')
WHERE id = 'pgv_codebase_1536'
  AND purpose = 'codebase'
  AND table_name = 'agentsam_codebase_chunks_gemini_embedding_2_1536';

INSERT INTO agentsam_routing_arms (
  id, task_type, mode, model_key, provider, workspace_id, model_catalog_id,
  priority, is_active, is_eligible, is_paused, budget_exhausted, supports_tools, updated_at
) VALUES
  ('ra_code_index_embed_gemini2_global', 'code_index_embed', 'embed', 'models/gemini-embedding-2', 'google', '', 'models/gemini-embedding-2', 95, 1, 1, 0, 0, 0, unixepoch()),
  ('ra_memory_embed_gemini2_global', 'memory_embed', 'embed', 'models/gemini-embedding-2', 'google', '', 'models/gemini-embedding-2', 95, 1, 1, 0, 0, 0, unixepoch()),
  ('ra_document_index_embed_openai_large_global', 'document_index_embed', 'embed', 'text-embedding-3-large', 'openai', '', 'text-embedding-3-large', 95, 1, 1, 0, 0, 0, unixepoch()),
  ('ra_embeddings_openai_large_global', 'embeddings', 'embed', 'text-embedding-3-large', 'openai', '', 'text-embedding-3-large', 90, 1, 1, 0, 0, 0, unixepoch()),
  ('ra_embeddings_multimodal_gemini2_global', 'embeddings_multimodal', 'embed', 'models/gemini-embedding-2', 'google', '', 'models/gemini-embedding-2', 90, 1, 1, 0, 0, 0, unixepoch())
ON CONFLICT(id) DO UPDATE SET
  task_type = excluded.task_type,
  mode = excluded.mode,
  model_key = excluded.model_key,
  provider = excluded.provider,
  workspace_id = excluded.workspace_id,
  model_catalog_id = excluded.model_catalog_id,
  priority = excluded.priority,
  is_active = 1,
  is_eligible = 1,
  is_paused = 0,
  budget_exhausted = 0,
  supports_tools = 0,
  updated_at = unixepoch();

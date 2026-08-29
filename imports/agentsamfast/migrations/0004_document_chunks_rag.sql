-- ============================================================================
-- AgentSam Cloudflare D1 / SQLite Migrations
-- Version: 0004_document_chunks_rag.sql
-- Description: Document Chunk Ingestion & Vector Embeddings Index for RAG Agent
-- ============================================================================

-- 1. Ingested Document Catalog (Sources, Filings, Transcripts)
CREATE TABLE IF NOT EXISTS agentsam_document_sources (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default_workspace',
  tenant_id TEXT NOT NULL DEFAULT 'default_tenant',
  ticker TEXT NOT NULL,
  title TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'filing'
    CHECK (document_type IN ('10-K', '10-Q', '8-K', '13F', 'Form 4', 'uploaded_file', 'earnings_transcript', 'sec_press_release', 'custom_memo')),
  source_type TEXT NOT NULL DEFAULT 'document',
  source_url TEXT,
  file_name TEXT,
  file_size_bytes INTEGER DEFAULT 0,
  content_hash TEXT,
  total_chunks INTEGER NOT NULL DEFAULT 0,
  token_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'indexed'
    CHECK (status IN ('pending', 'chunking', 'embedding', 'indexed', 'failed')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 2. Document Chunks (Canonical Text and Legacy Single-Model Storage)
CREATE TABLE IF NOT EXISTS agentsam_document_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  form_type TEXT,
  filing_date TEXT,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  section TEXT,
  section_title TEXT,
  chunk_text TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  char_count INTEGER NOT NULL DEFAULT 0,
  embedding_model TEXT DEFAULT 'models/text-embedding-004',
  embedding_dims INTEGER DEFAULT 768,
  embedding_json TEXT DEFAULT '[]', -- JSON serialized array of float32 weights
  similarity_boost REAL DEFAULT 1.0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (document_id) REFERENCES agentsam_document_sources(id) ON DELETE CASCADE
);

-- 3. RAG Query Audit Log (Semantic Search queries, retrieved chunks, hit scores)
CREATE TABLE IF NOT EXISTS agentsam_rag_queries (
  id TEXT PRIMARY KEY,
  ticker TEXT,
  query_text TEXT NOT NULL,
  model_used TEXT NOT NULL DEFAULT 'models/text-embedding-004',
  top_k INTEGER NOT NULL DEFAULT 5,
  retrieved_chunk_ids_json TEXT NOT NULL DEFAULT '[]',
  highest_similarity_score REAL DEFAULT 0.0,
  latency_ms INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- High-performance Edge Indexes
CREATE INDEX IF NOT EXISTS idx_doc_sources_ticker ON agentsam_document_sources(ticker);
CREATE INDEX IF NOT EXISTS idx_doc_sources_type ON agentsam_document_sources(document_type);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_ticker ON agentsam_document_chunks(ticker);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_doc ON agentsam_document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_created ON agentsam_document_chunks(created_at);
CREATE INDEX IF NOT EXISTS idx_rag_queries_ticker ON agentsam_rag_queries(ticker);

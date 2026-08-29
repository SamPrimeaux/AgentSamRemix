import { describe, it, expect, beforeAll } from "vitest";
import { getDatabase } from "../server/db/database.ts";
import { ChunkRepository, ProjectionRepository } from "../app/backend/ai/embeddings/canonicalRepositories.ts";
import { DocumentChunkService } from "../app/backend/services/documentChunkService.ts";

describe("Canonical Chunk / Projection Decoupling Test Suite", () => {
  beforeAll(async () => {
    const db = await getDatabase();
    await db.exec(`
      CREATE TABLE IF NOT EXISTS agentsam_document_sources (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'default_workspace',
        tenant_id TEXT NOT NULL DEFAULT 'default_tenant',
        ticker TEXT,
        title TEXT NOT NULL,
        document_type TEXT NOT NULL DEFAULT '10-K',
        source_type TEXT NOT NULL DEFAULT 'document',
        content_hash TEXT,
        total_chunks INTEGER DEFAULT 0,
        token_count INTEGER DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE IF NOT EXISTS agentsam_document_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT REFERENCES agentsam_document_sources(id) ON DELETE CASCADE,
        ticker TEXT,
        form_type TEXT,
        filing_date TEXT,
        chunk_index INTEGER NOT NULL DEFAULT 0,
        section TEXT,
        section_title TEXT,
        chunk_text TEXT NOT NULL,
        token_count INTEGER NOT NULL DEFAULT 0,
        char_count INTEGER NOT NULL DEFAULT 0,
        embedding_model TEXT,
        embedding_dims INTEGER,
        embedding_json TEXT,
        similarity_boost REAL DEFAULT 1.0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE IF NOT EXISTS agentsam_chunk_projections (
        id TEXT PRIMARY KEY,
        chunk_id TEXT NOT NULL REFERENCES agentsam_document_chunks(id) ON DELETE CASCADE,
        embedding_space_key TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector_json TEXT NOT NULL,
        vector_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE(chunk_id, embedding_space_key)
      );
    `);
  });

  it("should store and retrieve canonical text directly from ChunkRepository without projections", async () => {
    const db = await getDatabase();
    const docId = "doc_test_10k_001";
    await db.query(
      `INSERT OR REPLACE INTO agentsam_document_sources (id, ticker, title, document_type) 
       VALUES (?, 'AAPL', 'Apple 2024 Form 10-K', '10-K')`,
      [docId]
    );

    const chunks = [
      {
        id: "chk_001_0",
        documentId: docId,
        ticker: "AAPL",
        formType: "10-K",
        chunkIndex: 0,
        sectionTitle: "Item 1. Business",
        chunkText: "Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets, and wearables.",
        tokenCount: 18,
      },
      {
        id: "chk_001_1",
        documentId: docId,
        ticker: "AAPL",
        formType: "10-K",
        chunkIndex: 1,
        sectionTitle: "Item 7. MD&A",
        chunkText: "Total net sales increased 8% during fiscal year 2024 driven by Services and iPhone expansion.",
        tokenCount: 16,
      },
    ];

    await ChunkRepository.upsertChunks(chunks);

    const retrieved = await ChunkRepository.getChunksByDocument(docId);
    expect(retrieved.length).toBe(2);
    expect(retrieved[0].chunkText).toContain("Apple Inc. designs, manufactures");
    expect(retrieved[0].sectionTitle).toBe("Item 1. Business");
    expect(retrieved[1].chunkText).toContain("Total net sales increased 8%");
  });

  it("should store and index multi-space projections independently for the same canonical chunk", async () => {
    const chunkId = "chk_001_0";
    const vector768 = new Array(768).fill(0.12);
    const vector1536 = new Array(1536).fill(0.05);

    await ProjectionRepository.upsertProjections([
      {
        id: "proj_chk_001_0_768",
        chunkId,
        embeddingSpaceKey: "google:text-embedding-004:768:mean:v1",
        dimensions: 768,
        vector: vector768,
        vectorHash: "hash_768",
      },
      {
        id: "proj_chk_001_0_1536",
        chunkId,
        embeddingSpaceKey: "openai:text-embedding-3-small:1536:mean:v1",
        dimensions: 1536,
        vector: vector1536,
        vectorHash: "hash_1536",
      },
    ]);

    const projections = await ProjectionRepository.getProjectionsForChunk(chunkId);
    expect(projections.length).toBe(2);

    const proj768 = projections.find((p) => p.dimensions === 768);
    const proj1536 = projections.find((p) => p.dimensions === 1536);

    expect(proj768).toBeDefined();
    expect(proj768?.embeddingSpaceKey).toBe("google:text-embedding-004:768:mean:v1");
    expect(proj1536).toBeDefined();
    expect(proj1536?.embeddingSpaceKey).toBe("openai:text-embedding-3-small:1536:mean:v1");
  });

  it("should perform semantic similarity search against space projections and join canonical chunk metadata", async () => {
    const queryVector = new Array(768).fill(0.12);
    const results = await ProjectionRepository.searchProjections(
      queryVector,
      "google:text-embedding-004:768:mean:v1",
      { ticker: "AAPL", topK: 5 }
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunk.ticker).toBe("AAPL");
    expect(results[0].chunk.chunkText).toContain("Apple Inc. designs");
    expect(results[0].similarity).toBeCloseTo(1.0, 3);
  });
});

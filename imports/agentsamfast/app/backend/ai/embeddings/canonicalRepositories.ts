import crypto from "crypto";
import { getDatabase } from "../../../../server/db/database.ts";

/**
 * Canonical Document Source Record.
 */
export interface DocumentSourceRecord {
  id: string;
  workspaceId: string;
  tenantId: string;
  title: string;
  sourceType: string;
  sourceUri?: string;
  checksum?: string;
  metadata?: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Canonical Document Chunk Record (Text SSOT).
 * Stores the canonical extracted text, section title, and token metadata.
 * Completely decoupled from embedding model vectors.
 */
export interface CanonicalChunkRecord {
  id: string;
  documentId: string;
  ticker?: string;
  formType?: string;
  filingDate?: string;
  chunkIndex: number;
  sectionTitle?: string;
  chunkText: string;
  tokenCount: number;
  charCount?: number;
  metadata?: Record<string, any>;
  createdAt?: string;
}

/**
 * Space-Specific Chunk Projection Record (Vector SSOT).
 * Stores the exact high-dimensional float array for a specific embedding space.
 */
export interface ChunkProjectionRecord {
  id: string;
  chunkId: string;
  embeddingSpaceKey: string; // 'provider:model:dimensions:pooling:version'
  dimensions: number;
  vector: number[];
  vectorHash: string;
  createdAt?: string;
}

/**
 * Canonical Chunk Repository.
 * Manages document chunks as canonical textual entities in D1.
 */
export class ChunkRepository {
  /**
   * Upserts canonical chunks into D1.
   */
  static async upsertChunks(chunks: CanonicalChunkRecord[]): Promise<void> {
    const db = await getDatabase();
    for (const c of chunks) {
      await db.query(
        `INSERT OR REPLACE INTO agentsam_document_chunks (
          id, document_id, ticker, form_type, filing_date,
          chunk_index, section, chunk_text, token_count, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          c.id,
          c.documentId,
          c.ticker || null,
          c.formType || null,
          c.filingDate || null,
          c.chunkIndex,
          c.sectionTitle || "General",
          c.chunkText,
          c.tokenCount,
          JSON.stringify(c.metadata || {}),
        ]
      );
    }
  }

  /**
   * Retrieves canonical chunks directly by document ID without requiring projections.
   */
  static async getChunksByDocument(documentId: string): Promise<CanonicalChunkRecord[]> {
    const db = await getDatabase();
    const res = await db.query(
      `SELECT id, document_id, ticker, form_type, filing_date, chunk_index, section as section_title,
              chunk_text, token_count, metadata_json, created_at
       FROM agentsam_document_chunks
       WHERE document_id = ?
       ORDER BY chunk_index ASC`,
      [documentId]
    );

    return (res.results || []).map((row: any) => ({
      id: row.id,
      documentId: row.document_id,
      ticker: row.ticker,
      formType: row.form_type,
      filingDate: row.filing_date,
      chunkIndex: row.chunk_index,
      sectionTitle: row.section_title || row.section,
      chunkText: row.chunk_text,
      tokenCount: row.token_count,
      charCount: row.chunk_text ? row.chunk_text.length : 0,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
      createdAt: row.created_at,
    }));
  }

  /**
   * Retrieves a single canonical chunk by ID.
   */
  static async getChunkById(chunkId: string): Promise<CanonicalChunkRecord | null> {
    const db = await getDatabase();
    const res = await db.query(
      `SELECT id, document_id, ticker, form_type, filing_date, chunk_index, section as section_title,
              chunk_text, token_count, metadata_json, created_at
       FROM agentsam_document_chunks
       WHERE id = ? LIMIT 1`,
      [chunkId]
    );

    if (!res.results || res.results.length === 0) return null;
    const row = res.results[0];
    return {
      id: row.id,
      documentId: row.document_id,
      ticker: row.ticker,
      formType: row.form_type,
      filingDate: row.filing_date,
      chunkIndex: row.chunk_index,
      sectionTitle: row.section_title || row.section,
      chunkText: row.chunk_text,
      tokenCount: row.token_count,
      charCount: row.chunk_text ? row.chunk_text.length : 0,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
      createdAt: row.created_at,
    };
  }
}

/**
 * Canonical Projection Repository.
 * Manages space-specific vector projections in D1.
 */
export class ProjectionRepository {
  /**
   * Upserts vector projections for a set of chunks in a specific embedding space.
   */
  static async upsertProjections(projections: ChunkProjectionRecord[]): Promise<void> {
    const db = await getDatabase();
    for (const p of projections) {
      const vectorJson = JSON.stringify(p.vector);
      const vectorHash = crypto.createHash("sha256").update(vectorJson).digest("hex");
      await db.query(
        `INSERT OR REPLACE INTO agentsam_chunk_projections (
          id, chunk_id, embedding_space_key, dimensions, vector_json, vector_hash
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [p.id, p.chunkId, p.embeddingSpaceKey, p.dimensions, vectorJson, vectorHash]
      );
    }
  }

  /**
   * Retrieves projections for a given chunk across all or specific spaces.
   */
  static async getProjectionsForChunk(chunkId: string, embeddingSpaceKey?: string): Promise<ChunkProjectionRecord[]> {
    const db = await getDatabase();
    let sql = `SELECT id, chunk_id, embedding_space_key, dimensions, vector_json, vector_hash, created_at
               FROM agentsam_chunk_projections
               WHERE chunk_id = ?`;
    const params: any[] = [chunkId];

    if (embeddingSpaceKey) {
      sql += ` AND embedding_space_key = ?`;
      params.push(embeddingSpaceKey);
    }

    const res = await db.query(sql, params);
    return (res.results || []).map((row: any) => ({
      id: row.id,
      chunkId: row.chunk_id,
      embeddingSpaceKey: row.embedding_space_key,
      dimensions: Number(row.dimensions),
      vector: JSON.parse(row.vector_json),
      vectorHash: row.vector_hash,
      createdAt: row.created_at,
    }));
  }

  /**
   * Vector search joining canonical chunks with space projections.
   */
  static async searchProjections(
    queryVector: number[],
    embeddingSpaceKey: string,
    options: {
      ticker?: string;
      topK?: number;
      minSimilarity?: number;
    } = {}
  ): Promise<Array<{ chunk: CanonicalChunkRecord; similarity: number }>> {
    const db = await getDatabase();
    const topK = options.topK || 5;
    const minSim = options.minSimilarity ?? 0.15;
    const queryDims = queryVector.length;

    let sql = `
      SELECT 
        c.id as chunk_id, c.document_id, c.ticker, c.form_type, c.filing_date,
        c.chunk_index, c.section as section_title, c.chunk_text, c.token_count, c.metadata_json,
        p.id as projection_id, p.dimensions, p.vector_json
      FROM agentsam_chunk_projections p
      INNER JOIN agentsam_document_chunks c ON c.id = p.chunk_id
      WHERE p.embedding_space_key = ?
    `;
    const params: any[] = [embeddingSpaceKey];

    if (options.ticker) {
      sql += ` AND c.ticker = ?`;
      params.push(options.ticker.toUpperCase());
    }

    const res = await db.query(sql, params);
    const results: Array<{ chunk: CanonicalChunkRecord; similarity: number }> = [];

    for (const row of res.results || []) {
      try {
        const rowVec = JSON.parse(row.vector_json);
        if (rowVec.length !== queryDims) continue;

        const sim = this.cosineSimilarity(queryVector, rowVec);
        if (sim >= minSim) {
          results.push({
            chunk: {
              id: row.chunk_id,
              documentId: row.document_id,
              ticker: row.ticker,
              formType: row.form_type,
              filingDate: row.filing_date,
              chunkIndex: row.chunk_index,
              sectionTitle: row.section_title,
              chunkText: row.chunk_text,
              tokenCount: row.token_count,
              charCount: row.chunk_text ? row.chunk_text.length : 0,
              metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
            },
            similarity: sim,
          });
        }
      } catch (e) {}
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  private static cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let nA = 0;
    let nB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      nA += a[i] * a[i];
      nB += b[i] * b[i];
    }
    if (nA === 0 || nB === 0) return 0;
    return dot / (Math.sqrt(nA) * Math.sqrt(nB));
  }
}

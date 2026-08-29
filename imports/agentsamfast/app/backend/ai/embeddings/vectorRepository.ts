import { getDatabase } from "../../../../server/db/database.ts";
import {
  VectorRepository,
  VectorProjectionItem,
  VectorMatch,
  VectorSearchParams,
} from "./types.ts";

/**
 * Cloudflare D1 / SQLite Vector Repository Implementation.
 * Encapsulates vector projection storage, dimension compatibility verification,
 * and cosine similarity nearest-neighbor search.
 */
export class D1VectorRepository implements VectorRepository {
  /**
   * Computes cosine similarity between two float vectors.
   */
  public calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
    if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) return 0;
    if (vecA.length !== vecB.length) return 0; // Strict dimension equality

    let dotProduct = 0.0;
    let normA = 0.0;
    let normB = 0.0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Upserts or updates canonical chunk vector projections.
   */
  public async upsertProjections(items: VectorProjectionItem[]): Promise<void> {
    const db = await getDatabase();

    for (const item of items) {
      await db.query(
        `INSERT OR REPLACE INTO agentsam_document_chunks (
          id, document_id, ticker, chunk_index, section_title, 
          chunk_text, token_count, char_count, embedding_model, 
          embedding_dims, embedding_json, similarity_boost, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.id,
          item.documentId,
          item.ticker.toUpperCase(),
          item.chunkIndex,
          item.sectionTitle || "General",
          item.chunkText,
          item.tokenCount,
          item.charCount,
          item.embeddingModel,
          item.embeddingDimensions,
          JSON.stringify(item.vector),
          item.similarityBoost || 1.0,
          JSON.stringify({
            ...(item.metadata || {}),
            routeKey: item.routeKey,
            embeddingSpaceKey: item.embeddingSpaceKey,
            embeddingProvider: item.embeddingProvider,
            embeddingVersion: item.embeddingVersion,
          }),
        ]
      );
    }
  }

  /**
   * Searches for top-K semantically relevant chunks matching query vector.
   * Enforces strict embeddingSpaceKey and dimension equality.
   */
  public async search(params: VectorSearchParams): Promise<VectorMatch[]> {
    const db = await getDatabase();
    const topK = params.topK || 5;
    const minSim = params.minSimilarity ?? 0.15;
    const queryVector = params.vector;
    const queryDims = params.dimensions || queryVector.length;
    const targetSpaceKey = params.embeddingSpaceKey;

    if (queryVector.length !== queryDims) {
      throw new Error(`[VectorRepository] Query vector dimension mismatch: vector has ${queryVector.length} elements but query requires ${queryDims}.`);
    }

    if (targetSpaceKey) {
      const spaceDimsMatch = targetSpaceKey.match(/:(\d+):/);
      if (spaceDimsMatch && Number(spaceDimsMatch[1]) !== queryDims) {
        throw new Error(`[VectorRepository] Embedding space key dimension mismatch: space '${targetSpaceKey}' requires ${spaceDimsMatch[1]} dimensions, but received ${queryDims}.`);
      }
    }

    let sql = `SELECT id, document_id, ticker, chunk_index, section_title, chunk_text, token_count, char_count, embedding_model, embedding_dims, embedding_json, metadata_json, created_at FROM agentsam_document_chunks`;
    const queryArgs: any[] = [];

    if (params.ticker) {
      sql += ` WHERE ticker = ?`;
      queryArgs.push(params.ticker.toUpperCase());
    }

    sql += ` ORDER BY created_at DESC LIMIT 300`;

    const result = await db.query(sql, queryArgs);
    const candidates: VectorMatch[] = [];

    for (const row of result.results) {
      const storedDims = Number(row.embedding_dims);

      // 1. Dimension compatibility check
      if (storedDims !== queryDims) {
        continue;
      }

      try {
        const meta = row.metadata_json ? JSON.parse(row.metadata_json) : {};
        const storedSpaceKey = meta.embeddingSpaceKey || `${meta.embeddingProvider || 'google'}:${row.embedding_model}:${storedDims}:mean:${meta.embeddingVersion || 'v1'}`;

        // 2. Embedding space compatibility check (prevent cross-model/pooling comparisons)
        if (targetSpaceKey && storedSpaceKey !== targetSpaceKey) {
          continue;
        }

        const storedVector: number[] = JSON.parse(row.embedding_json);
        if (storedVector.length !== queryDims) continue;

        const similarity = this.calculateCosineSimilarity(queryVector, storedVector);
        if (similarity >= minSim) {
          candidates.push({
            chunkId: row.id,
            documentId: row.document_id,
            ticker: row.ticker,
            chunkIndex: row.chunk_index,
            sectionTitle: row.section_title,
            chunkText: row.chunk_text,
            tokenCount: row.token_count,
            charCount: row.char_count,
            similarity: Math.round(similarity * 1000) / 1000,
            routeKey: meta.routeKey,
            embeddingSpaceKey: storedSpaceKey,
            embeddingProvider: meta.embeddingProvider || "google",
            embeddingModel: row.embedding_model,
            embeddingDimensions: storedDims,
            embeddingVersion: meta.embeddingVersion || "v1",
            metadata: meta,
          });
        }
      } catch (e) {
        // Skip malformed vector rows
      }
    }

    candidates.sort((a, b) => b.similarity - a.similarity);
    return candidates.slice(0, topK);
  }

  public async deleteByDocument(documentId: string): Promise<void> {
    const db = await getDatabase();
    await db.query(`DELETE FROM agentsam_document_chunks WHERE document_id = ?`, [documentId]);
  }

  public async getProjectionsByDocument(documentId: string): Promise<VectorProjectionItem[]> {
    const db = await getDatabase();
    const result = await db.query(
      `SELECT id, document_id, ticker, chunk_index, section_title, chunk_text, token_count, char_count, embedding_model, embedding_dims, embedding_json, metadata_json, created_at FROM agentsam_document_chunks WHERE document_id = ? ORDER BY chunk_index ASC`,
      [documentId]
    );

    return result.results.map((row: any) => {
      const meta = row.metadata_json ? JSON.parse(row.metadata_json) : {};
      const dims = Number(row.embedding_dims);
      return {
        id: row.id,
        documentId: row.document_id,
        ticker: row.ticker,
        chunkIndex: row.chunk_index,
        sectionTitle: row.section_title,
        chunkText: row.chunk_text,
        tokenCount: row.token_count,
        charCount: row.char_count,
        routeKey: meta.routeKey || "docs:google-text-embed:v1",
        embeddingSpaceKey: meta.embeddingSpaceKey || `google:${row.embedding_model}:${dims}:mean:${meta.embeddingVersion || 'v1'}`,
        embeddingProvider: meta.embeddingProvider || "google",
        embeddingModel: row.embedding_model,
        embeddingDimensions: dims,
        embeddingVersion: meta.embeddingVersion || "v1",
        vector: JSON.parse(row.embedding_json),
        metadata: meta,
        createdAt: row.created_at,
      };
    });
  }
}

export const defaultVectorRepository = new D1VectorRepository();

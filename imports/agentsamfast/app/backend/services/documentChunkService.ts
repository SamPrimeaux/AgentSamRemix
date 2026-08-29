import crypto from "crypto";
import { getDatabase } from "../../../server/db/database.ts";
import {
  embeddingService,
  EmbeddingService,
  defaultVectorRepository,
  VectorRepository,
  VectorMatch,
  ResolveProviderOptions,
  ChunkRepository,
  ProjectionRepository,
  CanonicalChunkRecord,
  ChunkProjectionRecord,
} from "../ai/embeddings/index.ts";

/**
 * Enterprise Document Chunking & Provider-Agnostic Vector Service.
 * Implements intelligent semantic chunking, canonical source-of-truth storage,
 * decoupled vector projection indexing, and multi-model similarity search.
 */

export interface DocumentChunk {
  id: string;
  documentId: string;
  ticker: string;
  chunkIndex: number;
  sectionTitle?: string;
  chunkText: string;
  tokenCount: number;
  charCount: number;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimensions: number;
  embeddingVersion: string;
  similarity?: number;
  metadata?: Record<string, any>;
}

export interface IngestDocumentParams {
  ticker: string;
  title: string;
  documentType:
    | "10-K"
    | "10-Q"
    | "8-K"
    | "13F"
    | "Form 4"
    | "uploaded_file"
    | "earnings_transcript"
    | "sec_press_release"
    | "custom_memo";
  rawText: string;
  sourceUrl?: string;
  fileName?: string;
  fileSizeBytes?: number;
  metadata?: Record<string, any>;
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
}

export interface SearchChunksParams {
  ticker?: string;
  query: string;
  topK?: number;
  minSimilarity?: number;
  documentType?: string;
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
}

export class DocumentChunkService {
  constructor(
    private embeddings: EmbeddingService = embeddingService,
    private vectorRepo: VectorRepository = defaultVectorRepository
  ) {}

  /**
   * Splits financial documents intelligently by headers (Item 1, 7, MD&A, Footnotes)
   * while keeping financial tables and statement rows contiguous.
   * Provider-neutral chunking logic.
   */
  public chunkText(
    rawText: string,
    maxChunkTokens: number = 450,
    overlapTokens: number = 60
  ): Array<{ text: string; sectionTitle?: string }> {
    if (!rawText || !rawText.trim()) return [];

    const lines = rawText.split(/\r?\n/);
    const chunks: Array<{ text: string; sectionTitle?: string }> = [];

    let currentChunkLines: string[] = [];
    let currentSection = "General Disclosure";
    let currentEstimatedTokens = 0;

    const sectionRegex =
      /^(Item\s+[0-9A-Z]+[.:\s]|Part\s+[I|V|X]+|Management's Discussion|Financial Statements|Consolidated Statements|Note\s+[0-9]+|Risk Factors|Executive Summary|Overview|Guidance)/i;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        if (currentChunkLines.length > 0) {
          currentChunkLines.push("");
        }
        continue;
      }

      // Check for section header
      if (sectionRegex.test(trimmed) && trimmed.length < 120) {
        if (currentChunkLines.length > 0) {
          chunks.push({
            text: currentChunkLines.join("\n").trim(),
            sectionTitle: currentSection,
          });
          currentChunkLines = [];
          currentEstimatedTokens = 0;
        }
        currentSection = trimmed;
      }

      const lineTokens = Math.max(1, Math.round(line.length / 4));
      currentChunkLines.push(line);
      currentEstimatedTokens += lineTokens;

      if (currentEstimatedTokens >= maxChunkTokens) {
        chunks.push({
          text: currentChunkLines.join("\n").trim(),
          sectionTitle: currentSection,
        });

        // Retain overlap lines for context continuity
        const overlapCount = Math.min(3, currentChunkLines.length);
        const overlapLines = currentChunkLines.slice(-overlapCount);
        currentChunkLines = [...overlapLines];
        currentEstimatedTokens = Math.round(
          currentChunkLines.join("\n").length / 4
        );
      }
    }

    if (
      currentChunkLines.length > 0 &&
      currentChunkLines.join("").trim().length > 0
    ) {
      chunks.push({
        text: currentChunkLines.join("\n").trim(),
        sectionTitle: currentSection,
      });
    }

    return chunks.filter((c) => c.text.length >= 20);
  }

  /**
   * Ingests a raw document, parses into structured chunks, computes vector embeddings
   * via the resolved provider, and indexes chunks with full provenance.
   */
  public async ingestAndIndexDocument(params: IngestDocumentParams): Promise<{
    documentId: string;
    totalChunks: number;
    tokenCount: number;
    embeddingProvider: string;
    embeddingModel: string;
    embeddingDimensions: number;
    embeddingVersion: string;
    isExisting: boolean;
  }> {
    const db = await getDatabase();
    const ticker = params.ticker.toUpperCase().trim();
    const contentHash = crypto
      .createHash("sha256")
      .update(params.rawText)
      .digest("hex");

    // Check for idempotent duplicate ingestion by content hash
    const existingDoc = await db.query(
      `SELECT id, total_chunks, token_count FROM agentsam_document_sources WHERE ticker = ? AND content_hash = ?`,
      [ticker, contentHash]
    );

    let docId: string;
    let isExisting = false;

    if (existingDoc.results.length > 0) {
      docId = existingDoc.results[0].id;
      isExisting = true;
      console.log(
        `[Document Ingest] Idempotent match found for ${ticker} doc ${docId}. Updating vector projections...`
      );
    } else {
      docId = `doc_${ticker}_${Date.now()}_${crypto
        .randomBytes(3)
        .toString("hex")}`;
    }

    // 1. Chunk document
    const rawChunks = this.chunkText(params.rawText);
    if (rawChunks.length === 0) {
      rawChunks.push({
        text: params.rawText.slice(0, 2000),
        sectionTitle: params.title || "Full Document",
      });
    }

    // 2. Generate vector embeddings using decoupled EmbeddingService
    const chunkTexts = rawChunks.map((c) => c.text);
    const resolveOpts: ResolveProviderOptions = {
      preferredProvider: params.embeddingProvider,
      preferredModel: params.embeddingModel,
      requiredDimensions: params.embeddingDimensions,
      task: "document",
    };

    const batchEmbedResult = await this.embeddings.embedBatch(
      chunkTexts,
      resolveOpts
    );
    const totalTokens = rawChunks.reduce(
      (acc, c) => acc + Math.round(c.text.length / 4),
      0
    );

    // 3. Upsert Canonical Document Source Record
    if (!isExisting) {
      await db.query(
        `INSERT INTO agentsam_document_sources (
          id, ticker, title, document_type, source_url, file_name, 
          file_size_bytes, content_hash, total_chunks, token_count, 
          status, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'indexed', ?)`,
        [
          docId,
          ticker,
          params.title,
          params.documentType,
          params.sourceUrl || null,
          params.fileName || null,
          params.fileSizeBytes || params.rawText.length,
          contentHash,
          rawChunks.length,
          totalTokens,
          JSON.stringify({
            ...(params.metadata || {}),
            embeddingProvider: batchEmbedResult.provider,
            embeddingModel: batchEmbedResult.model,
            embeddingDimensions: batchEmbedResult.dimensions,
          }),
        ]
      );
    } else {
      await db.query(
        `UPDATE agentsam_document_sources SET 
          title = ?, document_type = ?, total_chunks = ?, token_count = ?, 
          metadata_json = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now')) 
        WHERE id = ?`,
        [
          params.title,
          params.documentType,
          rawChunks.length,
          totalTokens,
          JSON.stringify({
            ...(params.metadata || {}),
            embeddingProvider: batchEmbedResult.provider,
            embeddingModel: batchEmbedResult.model,
            embeddingDimensions: batchEmbedResult.dimensions,
          }),
          docId,
        ]
      );
    }

    // 3. Save Canonical Chunks to ChunkRepository (SSOT for extracted text)
    const canonicalChunks: CanonicalChunkRecord[] = rawChunks.map((chunk, i) => ({
      id: `chk_${docId}_${i}`,
      documentId: docId,
      ticker,
      formType: params.documentType,
      chunkIndex: i,
      sectionTitle: chunk.sectionTitle || "General",
      chunkText: chunk.text,
      tokenCount: Math.round(chunk.text.length / 4),
      charCount: chunk.text.length,
      metadata: {
        docTitle: params.title,
        docType: params.documentType,
      },
    }));

    await ChunkRepository.upsertChunks(canonicalChunks);

    // 4. Index Vector Projections via Vector & Projection Repositories
    const projectionRecords: ChunkProjectionRecord[] = rawChunks.map((chunk, i) => {
      const chunkId = `chk_${docId}_${i}`;
      return {
        id: `proj_${chunkId}_${batchEmbedResult.dimensions}`,
        chunkId,
        embeddingSpaceKey: batchEmbedResult.embeddingSpaceKey,
        dimensions: batchEmbedResult.dimensions,
        vector: batchEmbedResult.vectors[i],
        vectorHash: crypto.createHash("sha256").update(JSON.stringify(batchEmbedResult.vectors[i])).digest("hex"),
      };
    });

    await ProjectionRepository.upsertProjections(projectionRecords);

    const projectionItems = rawChunks.map((chunk, i) => {
      const chunkId = `chk_${docId}_${i}`;
      const tokenCount = Math.round(chunk.text.length / 4);
      return {
        id: chunkId,
        documentId: docId,
        ticker,
        chunkIndex: i,
        sectionTitle: chunk.sectionTitle || "General",
        chunkText: chunk.text,
        tokenCount,
        charCount: chunk.text.length,
        routeKey: "docs:google-text-embed:v1",
        embeddingSpaceKey: batchEmbedResult.embeddingSpaceKey,
        embeddingProvider: batchEmbedResult.provider,
        embeddingModel: batchEmbedResult.model,
        embeddingDimensions: batchEmbedResult.dimensions,
        embeddingVersion: batchEmbedResult.version,
        vector: batchEmbedResult.vectors[i],
        similarityBoost: 1.0,
        metadata: {
          docTitle: params.title,
          docType: params.documentType,
          section: chunk.sectionTitle,
        },
      };
    });

    await this.vectorRepo.upsertProjections(projectionItems);

    console.log(
      `[Document Ingest] Indexed ${rawChunks.length} chunks for ${ticker} using provider '${batchEmbedResult.provider}' (${batchEmbedResult.model}, ${batchEmbedResult.dimensions} dims).`
    );

    return {
      documentId: docId,
      totalChunks: rawChunks.length,
      tokenCount: totalTokens,
      embeddingProvider: batchEmbedResult.provider,
      embeddingModel: batchEmbedResult.model,
      embeddingDimensions: batchEmbedResult.dimensions,
      embeddingVersion: batchEmbedResult.version,
      isExisting,
    };
  }

  /**
   * Re-embeds an existing document with a new provider or dimension without duplicating
   * canonical document sources or chunks.
   */
  public async reembedDocument(
    documentId: string,
    options: ResolveProviderOptions = {}
  ): Promise<{
    documentId: string;
    chunksRebuilt: number;
    provider: string;
    model: string;
    dimensions: number;
  }> {
    const db = await getDatabase();
    const docRes = await db.query(
      `SELECT id, ticker, title, document_type FROM agentsam_document_sources WHERE id = ?`,
      [documentId]
    );

    if (docRes.results.length === 0) {
      throw new Error(`Document source '${documentId}' not found.`);
    }

    const doc = docRes.results[0];
    // Retrieve canonical text directly from ChunkRepository SSOT
    const canonicalChunks = await ChunkRepository.getChunksByDocument(documentId);

    if (canonicalChunks.length === 0) {
      throw new Error(`No canonical chunks found for document '${documentId}'.`);
    }

    const texts = canonicalChunks.map((c) => c.chunkText);
    const batchEmbedResult = await this.embeddings.embedBatch(texts, options);

    const projectionRecords: ChunkProjectionRecord[] = canonicalChunks.map((c, i) => ({
      id: `proj_${c.id}_${batchEmbedResult.dimensions}`,
      chunkId: c.id,
      embeddingSpaceKey: batchEmbedResult.embeddingSpaceKey,
      dimensions: batchEmbedResult.dimensions,
      vector: batchEmbedResult.vectors[i],
      vectorHash: crypto.createHash("sha256").update(JSON.stringify(batchEmbedResult.vectors[i])).digest("hex"),
    }));

    await ProjectionRepository.upsertProjections(projectionRecords);

    const updatedProjections = canonicalChunks.map((c, i) => ({
      id: c.id,
      documentId,
      ticker: c.ticker || doc.ticker,
      chunkIndex: c.chunkIndex,
      sectionTitle: c.sectionTitle,
      chunkText: c.chunkText,
      tokenCount: c.tokenCount,
      charCount: c.charCount || c.chunkText.length,
      routeKey: "docs:reembedded:v1",
      embeddingSpaceKey: batchEmbedResult.embeddingSpaceKey,
      embeddingProvider: batchEmbedResult.provider,
      embeddingModel: batchEmbedResult.model,
      embeddingDimensions: batchEmbedResult.dimensions,
      embeddingVersion: batchEmbedResult.version,
      vector: batchEmbedResult.vectors[i],
    }));

    await this.vectorRepo.upsertProjections(updatedProjections);

    // Update document metadata
    await db.query(
      `UPDATE agentsam_document_sources SET 
        metadata_json = json_set(metadata_json, '$.embeddingProvider', ?, '$.embeddingModel', ?, '$.embeddingDimensions', ?),
        updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      WHERE id = ?`,
      [
        batchEmbedResult.provider,
        batchEmbedResult.model,
        batchEmbedResult.dimensions,
        documentId,
      ]
    );

    console.log(
      `[Document Re-embed] Successfully re-embedded document ${documentId} (${doc.ticker}) with provider '${batchEmbedResult.provider}' (${batchEmbedResult.dimensions} dims).`
    );

    return {
      documentId,
      chunksRebuilt: updatedProjections.length,
      provider: batchEmbedResult.provider,
      model: batchEmbedResult.model,
      dimensions: batchEmbedResult.dimensions,
    };
  }

  /**
   * Searches for semantically relevant document chunks using the decoupled embedding service
   * and vector repository.
   */
  public async searchSimilarChunks(
    params: SearchChunksParams
  ): Promise<DocumentChunk[]> {
    const startTime = Date.now();
    const db = await getDatabase();
    const topK = params.topK || 5;

    // 1. Generate query embedding with matching provider / dimension requirements
    const embedResult = await this.embeddings.embed(params.query, {
      preferredProvider: params.embeddingProvider,
      preferredModel: params.embeddingModel,
      requiredDimensions: params.embeddingDimensions,
      task: "query",
    });

    // 2. Query Vector Repository with matching dimensions and space key
    const matches: VectorMatch[] = await this.vectorRepo.search({
      vector: embedResult.vector,
      embeddingSpaceKey: embedResult.embeddingSpaceKey,
      provider: embedResult.provider,
      model: embedResult.model,
      dimensions: embedResult.dimensions,
      ticker: params.ticker ? params.ticker.toUpperCase() : undefined,
      documentType: params.documentType,
      topK,
      minSimilarity: params.minSimilarity ?? 0.15,
    });

    // 3. Convert matches to canonical DocumentChunk representation
    const chunks: DocumentChunk[] = matches.map((m) => ({
      id: m.chunkId,
      documentId: m.documentId,
      ticker: m.ticker,
      chunkIndex: m.chunkIndex,
      sectionTitle: m.sectionTitle,
      chunkText: m.chunkText,
      tokenCount: m.tokenCount,
      charCount: m.charCount,
      embeddingProvider: m.embeddingProvider,
      embeddingModel: m.embeddingModel,
      embeddingDimensions: m.embeddingDimensions,
      embeddingVersion: m.embeddingVersion,
      similarity: m.similarity,
      metadata: m.metadata,
    }));

    // 4. Record audit query log
    const latency = Date.now() - startTime;
    const queryId = `rq_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    try {
      await db.query(
        `INSERT INTO agentsam_rag_queries (
          id, ticker, query_text, model_used, top_k, 
          retrieved_chunk_ids_json, highest_similarity_score, latency_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          queryId,
          params.ticker ? params.ticker.toUpperCase() : null,
          params.query,
          `${embedResult.provider}:${embedResult.model}`,
          topK,
          JSON.stringify(chunks.map((r) => r.id)),
          chunks.length > 0 ? chunks[0].similarity : 0.0,
          latency,
        ]
      );
    } catch (e) {
      // Non-blocking log insertion
    }

    return chunks;
  }

  /**
   * Builds an enriched RAG context block ready for injection into LLM prompts.
   */
  public async buildRAGContextPrompt(
    ticker: string,
    query: string,
    topK: number = 4
  ): Promise<string> {
    const chunks = await this.searchSimilarChunks({ ticker, query, topK });
    if (chunks.length === 0) return "";

    let context = `\n--- [AGENT SAM FAST VERIFIED RAG FILING INDEX FOR ${ticker.toUpperCase()}] ---\n`;
    chunks.forEach((c, idx) => {
      const docType = c.metadata?.docType || "Filing";
      const docTitle =
        c.metadata?.docTitle || c.sectionTitle || "SEC Disclosure";
      context += `\n[Source ${idx + 1}: ${docType} - "${docTitle}" (${
        c.embeddingProvider
      }/${c.embeddingModel}, Similarity: ${(
        (c.similarity || 0) * 100
      ).toFixed(1)}%)]\n${c.chunkText}\n`;
    });
    context += `--- [END RAG INDEX CONTEXT] ---\n\n`;

    return context;
  }
}

export const documentChunkService = new DocumentChunkService();

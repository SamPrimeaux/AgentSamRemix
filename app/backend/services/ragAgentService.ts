import { documentChunkService, DocumentChunk } from "./documentChunkService.ts";
import { getDatabase } from "../legacy/agentsamfast/database.ts";

/**
 * Enterprise RAG Agent Service.
 * Manages retrieval-augmented generation (RAG), groundings, and citation metadata
 * entirely through provider-neutral capability interfaces.
 * Never synthesizes fake SEC filing evidence.
 */

export interface SourceCitation {
  sourceId: string;
  chunkId: string;
  sourceUrl?: string;
  documentType: string;
  publishedAt?: string;
  contentHash?: string;
  sectionTitle?: string;
  retrievalScore: number;
  embeddingSpaceKey: string;
  embeddingProvider: string;
  embeddingModel: string;
  preview: string;
}

export interface GroundingContext {
  ticker: string;
  query: string;
  groundedPromptBlock: string;
  citations: SourceCitation[];
  totalRetrieved: number;
  corpusStatus: "ready" | "corpus_not_ready" | "empty";
}

export interface RAGAnalysisResult {
  ticker: string;
  query: string;
  retrievedChunks: DocumentChunk[];
  contextInjected: boolean;
  grounding: GroundingContext;
  groundedSummary?: string;
  sourceCitations: SourceCitation[];
}

export class RAGAgentService {
  /**
   * Checks if verified filing chunks exist for the ticker.
   * Does NOT synthesize fake filing text.
   */
  public async ensureTickerIndexed(ticker: string): Promise<number> {
    const db = await getDatabase();
    const cleanTicker = ticker.toUpperCase().trim();

    const existing = await db.query(
      `SELECT count(*) as count FROM agentsam_document_chunks WHERE ticker = ?`,
      [cleanTicker]
    );

    return Number(existing.results[0]?.count || 0);
  }

  /**
   * Phase 1: Retrieve semantic document chunks from vector index.
   */
  public async retrieve(params: {
    ticker?: string;
    query: string;
    topK?: number;
    embeddingProvider?: string;
    embeddingModel?: string;
  }): Promise<DocumentChunk[]> {
    if (params.ticker) {
      const indexedCount = await this.ensureTickerIndexed(params.ticker);
      if (indexedCount === 0) {
        return [];
      }
    }

    return documentChunkService.searchSimilarChunks({
      ticker: params.ticker ? params.ticker.toUpperCase() : undefined,
      query: params.query,
      topK: params.topK || 5,
      minSimilarity: 0.25,
      embeddingProvider: params.embeddingProvider,
      embeddingModel: params.embeddingModel,
    });
  }

  /**
   * Phase 2: Construct isolated, untrusted evidence Grounding Context from retrieved results.
   * Labels retrieved evidence strictly as UNTRUSTED RETRIEVED EVIDENCE.
   */
  public buildGrounding(
    ticker: string,
    query: string,
    chunks: DocumentChunk[]
  ): GroundingContext {
    const citations: SourceCitation[] = chunks.map((chunk) => ({
      sourceId: chunk.documentId,
      chunkId: chunk.id,
      sourceUrl: chunk.metadata?.sourceUrl,
      documentType: chunk.metadata?.docType || "Filing",
      publishedAt: chunk.metadata?.publishedAt,
      contentHash: chunk.metadata?.contentHash,
      sectionTitle: chunk.sectionTitle,
      retrievalScore: chunk.similarity || 0,
      embeddingSpaceKey: chunk.metadata?.embeddingSpaceKey || `${chunk.embeddingProvider}:${chunk.embeddingModel}:${chunk.embeddingDimensions}:mean:${chunk.embeddingVersion}`,
      embeddingProvider: chunk.embeddingProvider,
      embeddingModel: chunk.embeddingModel,
      preview:
        chunk.chunkText.slice(0, 180) +
        (chunk.chunkText.length > 180 ? "..." : ""),
    }));

    if (chunks.length === 0) {
      return {
        ticker: ticker.toUpperCase(),
        query,
        groundedPromptBlock: "",
        citations: [],
        totalRetrieved: 0,
        corpusStatus: "corpus_not_ready",
      };
    }

    let block = `\n--- [UNTRUSTED RETRIEVED EVIDENCE FOR ${ticker.toUpperCase()}] ---\n`;
    chunks.forEach((c, idx) => {
      const docType = c.metadata?.docType || "Filing";
      const docTitle =
        c.metadata?.docTitle || c.sectionTitle || "SEC Disclosure";
      block += `\n[Citation #${idx + 1} | ${docType} "${docTitle}" | Chunk: ${c.id} | Prov: ${
        c.embeddingProvider
      }/${c.embeddingModel} | Score: ${(
        (c.similarity || 0) * 100
      ).toFixed(1)}%]\n${c.chunkText}\n`;
    });
    block += `--- [END UNTRUSTED RETRIEVED EVIDENCE] ---\n\n`;

    return {
      ticker: ticker.toUpperCase(),
      query,
      groundedPromptBlock: block,
      citations,
      totalRetrieved: chunks.length,
      corpusStatus: "ready",
    };
  }

  /**
   * Phase 3: Execute full RAG Query pipeline (Retrieve -> Ground -> Package Analysis).
   */
  public async executeRAGQuery(
    ticker: string,
    query: string,
    options: { topK?: number; embeddingProvider?: string } = {}
  ): Promise<RAGAnalysisResult> {
    const chunks = await this.retrieve({
      ticker,
      query,
      topK: options.topK || 4,
      embeddingProvider: options.embeddingProvider,
    });

    const grounding = this.buildGrounding(ticker, query, chunks);

    return {
      ticker: ticker.toUpperCase(),
      query,
      retrievedChunks: chunks,
      contextInjected: chunks.length > 0,
      grounding,
      sourceCitations: grounding.citations,
    };
  }
}

export const ragAgentService = new RAGAgentService();

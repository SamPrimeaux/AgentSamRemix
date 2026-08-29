import { describe, it, expect, beforeAll } from "vitest";
import {
  embeddingService,
  embeddingResolver,
  defaultVectorRepository,
  EmbeddingRouteResolver,
} from "../app/backend/ai/embeddings/index.ts";
import { documentChunkService } from "../app/backend/services/documentChunkService.ts";
import { ragAgentService } from "../app/backend/services/ragAgentService.ts";
import { getDatabase } from "../server/db/database.ts";

describe("AgentSam Provider-Agnostic Embedding Test Suite", () => {
  beforeAll(async () => {
    const dbInit = await getDatabase();
    await dbInit.query(`DELETE FROM agentsam_document_chunks WHERE ticker = 'TEST'`);
    await dbInit.query(`DELETE FROM agentsam_document_sources WHERE ticker = 'TEST'`);
  });

  it("1. Provider Capabilities & Registry", () => {
    const caps = embeddingService.listCapabilities();
    expect(caps.length).toBeGreaterThanOrEqual(3);
    const geminiCap = caps.find((c) => c.providerKey === "google");
    const openaiCap = caps.find((c) => c.providerKey === "openai");
    const workersCap = caps.find((c) => c.providerKey === "workers-ai");

    expect(Boolean(geminiCap)).toBe(true);
    expect(Boolean(openaiCap)).toBe(true);
    expect(Boolean(workersCap)).toBe(true);
  });

  it("2. Fail-Closed Incompatible Dimension Rejection", () => {
    expect(() => {
      embeddingResolver.resolve({
        preferredProvider: "google",
        requiredDimensions: 9999,
      });
    }).toThrow(/embedding_provider_unavailable/);
  });

  it("3. Provider Fallback on Unavailable Provider", () => {
    const resolved = embeddingResolver.resolve({ preferredProvider: "openai" });
    expect(resolved.fallbackApplied).toBe(true);
    expect(resolved.provider.key === "google" || resolved.provider.key === "workers-ai").toBe(true);
  });

  it("4. Embedding Route Control Plane Resolution", async () => {
    const route = await EmbeddingRouteResolver.resolveRoute({
      purpose: "codebase",
      requiredDimensions: 768,
    });

    expect(Boolean(route.routeKey)).toBe(true);
    expect(route.dimensions).toBe(768);
    expect(route.embeddingSpaceKey).toContain("768");
  });

  it("5. Financial Chunking Rules", () => {
    const sampleFinancialDoc = `Item 1. Business - Demo Corp
Demo Corp provides high performance AI platforms.
Item 7. Management's Discussion and Analysis
Revenues grew 40% year-over-year. Operating margin reached 32%.
Item 1A. Risk Factors
Risks include component availability and currency volatility.`;

    const chunks = documentChunkService.chunkText(sampleFinancialDoc);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks.some((c) => c.sectionTitle?.includes("Item 7"))).toBe(true);
  });

  it("6. Vector Repository Invariant Enforcement (Mismatched Dimensions)", async () => {
    const db = await getDatabase();
    const docId = "doc_test_inv_1";

    // Insert canonical source parent first
    await db.query(
      `INSERT OR REPLACE INTO agentsam_document_sources (
        id, ticker, title, document_type, total_chunks, token_count, status
      ) VALUES (?, 'TEST', 'Test Source', '10-K', 1, 10, 'indexed')`,
      [docId]
    );

    const dummyVector = new Array(768).fill(0.05);

    await defaultVectorRepository.upsertProjections([
      {
        id: "chk_test_inv_1",
        documentId: docId,
        ticker: "TEST",
        chunkIndex: 0,
        sectionTitle: "Risk Factors",
        chunkText: "Component shortages and supply chain pressure.",
        tokenCount: 8,
        charCount: 45,
        routeKey: "code:google-text-embed:v1",
        embeddingSpaceKey: "google:text-embedding-004:768:mean:v1",
        embeddingProvider: "google",
        embeddingModel: "text-embedding-004",
        embeddingDimensions: 768,
        embeddingVersion: "v1",
        vector: dummyVector,
      },
    ]);

    // Query with matching dimension and space key
    const matches = await defaultVectorRepository.search({
      vector: dummyVector,
      embeddingSpaceKey: "google:text-embedding-004:768:mean:v1",
      dimensions: 768,
      ticker: "TEST",
    });

    expect(matches.length).toBe(1);
    expect(matches[0].ticker).toBe("TEST");

    // Query with mismatched dimensions throws fail-closed error
    await expect(
      defaultVectorRepository.search({
        vector: new Array(512).fill(0.01),
        embeddingSpaceKey: "google:text-embedding-004:768:mean:v1",
        dimensions: 512,
        ticker: "TEST",
      })
    ).rejects.toThrow(/dimension mismatch/i);
  });

  it("7. RAG Grounding Engine never synthesizes fake SEC filing evidence", async () => {
    const emptyCount = await ragAgentService.ensureTickerIndexed("UNINDEXED_TICKER");
    expect(emptyCount).toBe(0);

    const ragRes = await ragAgentService.executeRAGQuery("UNINDEXED_TICKER", "What was revenue?");
    expect(ragRes.retrievedChunks.length).toBe(0);
    expect(ragRes.grounding.corpusStatus).toBe("corpus_not_ready");
    expect(ragRes.grounding.groundedPromptBlock).toBe("");
  });
});

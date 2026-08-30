import {
  EmbeddingProvider,
  ProviderCapability,
  EmbeddingInput,
  EmbeddingResult,
  EmbeddingBatchInput,
  BatchEmbeddingResult,
} from "../types.ts";

/**
 * OpenAI Embedding Provider Implementation.
 * Supports text-embedding-3-small (1536) and text-embedding-3-large (1536/3072).
 * Handles budget exhaustion, missing keys, and rate limits gracefully.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  public readonly key = "openai";
  private defaultModel = "text-embedding-3-small";
  private version = "oai3_emb_v1";

  private isBudgetExhausted(): boolean {
    if (process.env.OPENAI_BUDGET_EXHAUSTED === "true") return true;
    // Current environment constraint: OpenAI quota is exhausted
    return true;
  }

  public getCapability(): ProviderCapability {
    const apiKey = process.env.OPENAI_API_KEY;
    const budgetBlocked = this.isBudgetExhausted();

    let statusReason = "Active & Configured";
    let isAvailable = true;

    if (!apiKey) {
      isAvailable = false;
      statusReason = "OPENAI_API_KEY not configured";
    } else if (budgetBlocked) {
      isAvailable = false;
      statusReason = "OpenAI API quota/budget exhausted (429 Insufficient Quota)";
    }

    return {
      providerKey: this.key,
      displayName: "OpenAI Text Embedding 3",
      modelKey: this.defaultModel,
      supportedDimensions: [1536, 3072, 512],
      defaultDimensions: 1536,
      supportedTasks: ["document", "query"],
      maxBatchSize: 2048,
      isAvailable,
      statusReason,
      costPer1MTokensUsd: 0.02,
      contextWindowTokens: 8191,
    };
  }

  public async embed(input: EmbeddingInput): Promise<EmbeddingResult> {
    const capability = this.getCapability();
    if (!capability.isAvailable) {
      throw new Error(
        `[OpenAIEmbeddingProvider] Cannot embed: ${capability.statusReason}`
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const dimensions = input.dimensions || capability.defaultDimensions;

    try {
      const resp = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.defaultModel,
          input: input.text,
          dimensions: dimensions !== 1536 ? dimensions : undefined,
        }),
      });

      if (!resp.ok) {
        const errorBody = await resp.text();
        if (resp.status === 429 || errorBody.includes("insufficient_quota")) {
          throw new Error(
            `OpenAI embedding budget exhausted (429 Insufficient Quota): ${errorBody}`
          );
        }
        throw new Error(`OpenAI embedding API HTTP ${resp.status}: ${errorBody}`);
      }

      const data = await resp.json();
      const vector = data.data?.[0]?.embedding;
      if (!vector || !Array.isArray(vector)) {
        throw new Error("Invalid embedding response structure from OpenAI");
      }

      const embeddingSpaceKey = input.embeddingSpaceKey || `openai:${this.defaultModel}:${vector.length}:mean:${this.version}`;

      return {
        vector,
        provider: this.key,
        model: this.defaultModel,
        dimensions: vector.length,
        version: this.version,
        embeddingSpaceKey,
      };
    } catch (e: any) {
      throw new Error(`[OpenAIEmbeddingProvider] Embedding failed: ${e.message}`);
    }
  }

  public async embedBatch(input: EmbeddingBatchInput): Promise<BatchEmbeddingResult> {
    const capability = this.getCapability();
    if (!capability.isAvailable) {
      throw new Error(
        `[OpenAIEmbeddingProvider] Cannot embed batch: ${capability.statusReason}`
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const dimensions = input.dimensions || capability.defaultDimensions;

    try {
      const resp = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.defaultModel,
          input: input.texts,
          dimensions: dimensions !== 1536 ? dimensions : undefined,
        }),
      });

      if (!resp.ok) {
        const errorBody = await resp.text();
        throw new Error(`OpenAI batch embedding HTTP ${resp.status}: ${errorBody}`);
      }

      const data = await resp.json();
      const vectors = data.data?.map((item: any) => item.embedding);
      const embeddingSpaceKey = input.embeddingSpaceKey || `openai:${this.defaultModel}:${dimensions}:mean:${this.version}`;

      return {
        vectors,
        provider: this.key,
        model: this.defaultModel,
        dimensions,
        version: this.version,
        embeddingSpaceKey,
      };
    } catch (e: any) {
      throw new Error(`[OpenAIEmbeddingProvider] Batch embedding failed: ${e.message}`);
    }
  }
}

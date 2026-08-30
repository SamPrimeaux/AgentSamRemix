import {
  EmbeddingProvider,
  ProviderCapability,
  EmbeddingInput,
  EmbeddingResult,
  EmbeddingBatchInput,
  BatchEmbeddingResult,
} from "../types.ts";

/**
 * Cloudflare Workers AI Embedding Provider.
 * Supports @cf/baai/bge-base-en-v1.5 (768 dims) and @cf/baai/bge-large-en-v1.5 (1024 dims).
 * Fails closed without synthetic vectors or dimension reshaping.
 */
export class WorkersAIEmbeddingProvider implements EmbeddingProvider {
  public readonly key = "workers-ai";
  private defaultModel = "@cf/baai/bge-base-en-v1.5";
  private version = "v1";

  public getCapability(): ProviderCapability {
    const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const cfApiToken = process.env.CLOUDFLARE_API_TOKEN;
    const hasCredentials = Boolean(cfAccountId && cfApiToken);

    return {
      providerKey: this.key,
      displayName: "Cloudflare Workers AI (BGE)",
      modelKey: this.defaultModel,
      supportedDimensions: [768, 1024, 384],
      defaultDimensions: 768,
      supportedTasks: ["document", "query"],
      maxBatchSize: 100,
      isAvailable: hasCredentials,
      statusReason: hasCredentials
        ? "Active (Cloudflare REST)"
        : "CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not configured",
      costPer1MTokensUsd: 0.011,
      contextWindowTokens: 512,
    };
  }

  public async embed(input: EmbeddingInput): Promise<EmbeddingResult> {
    const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const cfApiToken = process.env.CLOUDFLARE_API_TOKEN;
    const capability = this.getCapability();
    const dimensions = input.dimensions || capability.defaultDimensions;

    if (!capability.supportedDimensions.includes(dimensions)) {
      throw new Error(
        `[WorkersAIEmbeddingProvider] Unsupported output dimensionality: ${dimensions}. Supported dimensions: [${capability.supportedDimensions.join(", ")}]`
      );
    }

    if (!cfAccountId || !cfApiToken) {
      throw new Error("[WorkersAIEmbeddingProvider] Cannot embed: CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN missing.");
    }

    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/run/${this.defaultModel}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfApiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: input.text }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Cloudflare AI HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const vector = data.result?.data?.[0] || (data.result?.shape ? data.result.data : null);

      if (!vector || !Array.isArray(vector)) {
        throw new Error("Invalid embedding response structure from Cloudflare Workers AI");
      }

      if (vector.length !== dimensions) {
        throw new Error(
          `[WorkersAIEmbeddingProvider] Native dimension mismatch: requested ${dimensions}, received ${vector.length}.`
        );
      }

      const embeddingSpaceKey = input.embeddingSpaceKey || `workers_ai:${this.defaultModel}:${dimensions}:mean:${this.version}`;

      return {
        vector,
        provider: this.key,
        model: this.defaultModel,
        dimensions: vector.length,
        version: this.version,
        embeddingSpaceKey,
      };
    } catch (err: any) {
      throw new Error(`[WorkersAIEmbeddingProvider] Embedding failed: ${err.message}`);
    }
  }

  public async embedBatch(input: EmbeddingBatchInput): Promise<BatchEmbeddingResult> {
    const dimensions = input.dimensions || 768;
    const results = await Promise.all(
      input.texts.map((t) =>
        this.embed({ text: t, task: input.task, dimensions, embeddingSpaceKey: input.embeddingSpaceKey })
      )
    );

    const embeddingSpaceKey = input.embeddingSpaceKey || `workers_ai:${this.defaultModel}:${dimensions}:mean:${this.version}`;

    return {
      vectors: results.map((r) => r.vector),
      provider: this.key,
      model: this.defaultModel,
      dimensions,
      version: this.version,
      embeddingSpaceKey,
    };
  }
}

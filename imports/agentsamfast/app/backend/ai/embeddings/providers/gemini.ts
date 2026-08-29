import { GoogleGenAI } from "@google/genai";
import {
  EmbeddingProvider,
  ProviderCapability,
  EmbeddingInput,
  EmbeddingResult,
  EmbeddingBatchInput,
  BatchEmbeddingResult,
} from "../types.ts";

/**
 * Gemini Embedding Provider Implementation.
 * Uses Google GenAI SDK with support for native output dimensionality.
 * Fails closed without synthetic vectors or manual slicing/padding.
 */
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  public readonly key = "google";
  private defaultModel = "text-embedding-004";
  private version = "v1";

  private getGenAI(): GoogleGenAI | null {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }

  public getCapability(): ProviderCapability {
    const apiKey = process.env.GEMINI_API_KEY;
    return {
      providerKey: this.key,
      displayName: "Google Gemini Embedding 2.0",
      modelKey: this.defaultModel,
      supportedDimensions: [768, 512, 256],
      defaultDimensions: 768,
      supportedTasks: ["document", "query"],
      maxBatchSize: 10,
      isAvailable: Boolean(apiKey),
      statusReason: apiKey ? "Active & Healthy" : "GEMINI_API_KEY not configured",
      costPer1MTokensUsd: 0.08,
      contextWindowTokens: 8192,
    };
  }

  public async embed(input: EmbeddingInput): Promise<EmbeddingResult> {
    const ai = this.getGenAI();
    const dimensions = input.dimensions || 768;
    const model = this.defaultModel;
    const capability = this.getCapability();

    if (!capability.supportedDimensions.includes(dimensions)) {
      throw new Error(
        `[GeminiEmbeddingProvider] Unsupported output dimensionality: ${dimensions}. Supported dimensions: [${capability.supportedDimensions.join(", ")}]`
      );
    }

    if (!ai) {
      throw new Error(`[GeminiEmbeddingProvider] Cannot embed: GEMINI_API_KEY is not configured.`);
    }

    try {
      const sanitizedText = input.text.slice(0, 8000);
      const response = await ai.models.embedContent({
        model,
        contents: sanitizedText,
        config: {
          outputDimensionality: dimensions,
        },
      });

      const res = response as any;
      let values: number[] = [];
      if (res.embedding?.values) {
        values = res.embedding.values;
      } else if (res.embeddings && res.embeddings[0]?.values) {
        values = res.embeddings[0].values;
      }

      if (values.length === 0) {
        throw new Error("Empty embedding returned from Gemini API");
      }

      if (values.length !== dimensions) {
        throw new Error(
          `[GeminiEmbeddingProvider] Native dimension mismatch: requested ${dimensions}, received ${values.length}.`
        );
      }

      const embeddingSpaceKey = input.embeddingSpaceKey || `google:${model}:${dimensions}:mean:${this.version}`;

      return {
        vector: values,
        provider: this.key,
        model,
        dimensions: values.length,
        version: this.version,
        embeddingSpaceKey,
      };
    } catch (err: any) {
      throw new Error(`[GeminiEmbeddingProvider] Embedding failure: ${err.message}`);
    }
  }

  public async embedBatch(input: EmbeddingBatchInput): Promise<BatchEmbeddingResult> {
    const dimensions = input.dimensions || 768;
    const results: number[][] = [];
    const batchSize = 5;

    for (let i = 0; i < input.texts.length; i += batchSize) {
      const slice = input.texts.slice(i, i + batchSize);
      const promises = slice.map((text) =>
        this.embed({ text, task: input.task, dimensions, embeddingSpaceKey: input.embeddingSpaceKey })
      );
      const chunkResults = await Promise.all(promises);
      results.push(...chunkResults.map((r) => r.vector));
    }

    const embeddingSpaceKey = input.embeddingSpaceKey || `google:${this.defaultModel}:${dimensions}:mean:${this.version}`;

    return {
      vectors: results,
      provider: this.key,
      model: this.defaultModel,
      dimensions,
      version: this.version,
      embeddingSpaceKey,
    };
  }
}

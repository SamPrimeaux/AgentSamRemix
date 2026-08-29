import {
  EmbeddingInput,
  EmbeddingBatchInput,
  EmbeddingResult,
  BatchEmbeddingResult,
  ResolveProviderOptions,
  ProviderCapability,
} from "./types.ts";
import { defaultEmbeddingResolver, EmbeddingProviderResolver } from "./resolver.ts";
import { D1VectorRepository, defaultVectorRepository } from "./vectorRepository.ts";
import { EmbeddingRouteResolver, EmbeddingRouteConfig, ResolveRouteParams } from "./embeddingRouteResolver.ts";

export * from "./types.ts";
export * from "./resolver.ts";
export * from "./embeddingRouteResolver.ts";
export * from "./vectorRepository.ts";
export * from "./canonicalRepositories.ts";
export * from "./providers/gemini.ts";
export * from "./providers/openai.ts";
export * from "./providers/workers-ai.ts";

export const embeddingResolver = defaultEmbeddingResolver;

/**
 * Enterprise Embedding Service.
 * Provides high-level embedding APIs decoupled from underlying LLM / model vendors.
 */
export class EmbeddingService {
  constructor(
    private resolver: EmbeddingProviderResolver = defaultEmbeddingResolver,
    private routeResolver: typeof EmbeddingRouteResolver = EmbeddingRouteResolver
  ) {}

  /**
   * Generates a vector embedding for text using the optimal or requested provider / route.
   */
  public async embed(
    text: string,
    options: ResolveProviderOptions = {}
  ): Promise<EmbeddingResult> {
    const { provider, resolvedDimensions } = this.resolver.resolve(options);
    return provider.embed({
      text,
      task: options.task || "document",
      dimensions: resolvedDimensions,
      embeddingSpaceKey: options.requiredEmbeddingSpaceKey,
    });
  }

  /**
   * Generates vector embeddings for multiple texts in batch.
   */
  public async embedBatch(
    texts: string[],
    options: ResolveProviderOptions = {}
  ): Promise<BatchEmbeddingResult> {
    const { provider, resolvedDimensions } = this.resolver.resolve(options);
    return provider.embedBatch({
      texts,
      task: options.task || "document",
      dimensions: resolvedDimensions,
      embeddingSpaceKey: options.requiredEmbeddingSpaceKey,
    });
  }

  /**
   * Embeds text using an authoritative named route (e.g. codebase, documents, memory).
   */
  public async embedByRoute(
    text: string,
    routeParams: ResolveRouteParams
  ): Promise<EmbeddingResult & { routeKey: string }> {
    const route = await this.routeResolver.resolveRoute(routeParams);
    const { provider } = this.resolver.resolve({
      preferredProvider: route.provider,
      requiredDimensions: route.dimensions,
      requiredEmbeddingSpaceKey: route.embeddingSpaceKey,
      task: routeParams.taskMode || "document",
    });

    const res = await provider.embed({
      text,
      task: routeParams.taskMode || "document",
      dimensions: route.dimensions,
      embeddingSpaceKey: route.embeddingSpaceKey,
      routeKey: route.routeKey,
    });

    return {
      ...res,
      routeKey: route.routeKey,
    };
  }

  public listCapabilities(): ProviderCapability[] {
    return this.resolver.listCapabilities();
  }

  public resolveProvider(options: ResolveProviderOptions = {}) {
    return this.resolver.resolve(options);
  }
}

export const embeddingService = new EmbeddingService();

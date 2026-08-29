import {
  EmbeddingProvider,
  ProviderCapability,
  ResolveProviderOptions,
} from "./types.ts";
import { GeminiEmbeddingProvider } from "./providers/gemini.ts";
import { OpenAIEmbeddingProvider } from "./providers/openai.ts";
import { WorkersAIEmbeddingProvider } from "./providers/workers-ai.ts";

/**
 * Provider Resolver & Registry for Canonical Multi-Model Embedding.
 * Decouples application logic from specific AI models and handles
 * provider routing, dimension validation, and quota fallback safely.
 */
export class EmbeddingProviderResolver {
  private providers: Map<string, EmbeddingProvider> = new Map();

  constructor() {
    this.registerProvider(new GeminiEmbeddingProvider());
    this.registerProvider(new OpenAIEmbeddingProvider());
    this.registerProvider(new WorkersAIEmbeddingProvider());
  }

  public registerProvider(provider: EmbeddingProvider): void {
    this.providers.set(provider.key.toLowerCase(), provider);
  }

  public getProvider(key: string): EmbeddingProvider | null {
    return this.providers.get(key.toLowerCase()) || null;
  }

  public listCapabilities(): ProviderCapability[] {
    return Array.from(this.providers.values()).map((p) => p.getCapability());
  }

  /**
   * Resolves the optimal available embedding provider based on requested parameters,
   * dimensions, and runtime service health.
   */
  public resolve(options: ResolveProviderOptions = {}): {
    provider: EmbeddingProvider;
    capability: ProviderCapability;
    resolvedDimensions: number;
    fallbackApplied: boolean;
    fallbackReason?: string;
  } {
    const { preferredProvider, requiredProvider, requiredDimensions } = options;

    // 1. Strict required provider constraint
    if (requiredProvider) {
      const explicit = this.getProvider(requiredProvider);
      if (!explicit) {
        throw new Error(
          `[EmbeddingResolver] Unknown required provider: '${requiredProvider}'. Registered: ${Array.from(
            this.providers.keys()
          ).join(", ")}`
        );
      }
      const cap = explicit.getCapability();
      if (requiredDimensions && !cap.supportedDimensions.includes(requiredDimensions)) {
        throw new Error(
          `[EmbeddingResolver] Incompatible dimension: Required provider '${requiredProvider}' supports [${cap.supportedDimensions.join(", ")}], but ${requiredDimensions} was requested.`
        );
      }
      if (!cap.isAvailable) {
        throw new Error(
          `[EmbeddingResolver] embedding_provider_unavailable: Required provider '${requiredProvider}' is unavailable: ${cap.statusReason}`
        );
      }
      return {
        provider: explicit,
        capability: cap,
        resolvedDimensions: requiredDimensions || cap.defaultDimensions,
        fallbackApplied: false,
      };
    }

    // 2. Soft preferred provider
    if (preferredProvider) {
      const preferred = this.getProvider(preferredProvider);
      if (preferred) {
        const cap = preferred.getCapability();
        const dimMatches = !requiredDimensions || cap.supportedDimensions.includes(requiredDimensions);
        if (cap.isAvailable && dimMatches) {
          return {
            provider: preferred,
            capability: cap,
            resolvedDimensions: requiredDimensions || cap.defaultDimensions,
            fallbackApplied: false,
          };
        }
      }
    }

    // 3. Select first healthy provider matching dimension requirements
    const allProviders = Array.from(this.providers.values());
    for (const p of allProviders) {
      const cap = p.getCapability();
      if (!cap.isAvailable) continue;

      if (requiredDimensions && !cap.supportedDimensions.includes(requiredDimensions)) {
        continue;
      }

      const fallbackApplied = Boolean(preferredProvider && preferredProvider !== p.key);
      return {
        provider: p,
        capability: cap,
        resolvedDimensions: requiredDimensions || cap.defaultDimensions,
        fallbackApplied,
        fallbackReason: fallbackApplied
          ? `Preferred provider '${preferredProvider}' unavailable. Using registered fallback '${p.key}'.`
          : undefined,
      };
    }

    // 4. Fail closed if no healthy provider satisfies constraints
    throw new Error(
      `[EmbeddingResolver] embedding_provider_unavailable: No active healthy provider matches the requested constraints (requiredDimensions: ${requiredDimensions || 'any'}, preferredProvider: ${preferredProvider || 'any'}).`
    );
  }
}

export const defaultEmbeddingResolver = new EmbeddingProviderResolver();

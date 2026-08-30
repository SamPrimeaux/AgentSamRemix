import { getDatabase } from "../../legacy/agentsamfast/database.ts";

export interface EmbeddingRouteConfig {
  routeKey: string;
  purpose: 'codebase' | 'memory' | 'documents' | 'schema' | 'archive' | 'media';
  provider: string; // 'google', 'openai', 'workers_ai', 'local', 'ollama'
  modelKey: string;
  dimensions: number;
  metric: 'cosine' | 'euclidean' | 'dot';
  pooling: string;
  embeddingSpaceKey: string;
  embeddingVersion: string;
  vectorStore: 'd1_sqlite' | 'pgvector' | 'vectorize' | 'hybrid';
  isActive: boolean;
  isPreferred: boolean;
  costPerMillionTokens: number;
}

export interface ResolveRouteParams {
  purpose: 'codebase' | 'memory' | 'documents' | 'schema' | 'archive' | 'media';
  preferredProvider?: string;
  requiredProvider?: string;
  requiredDimensions?: number;
  requiredEmbeddingSpaceKey?: string;
  taskMode?: 'query' | 'document';
}

export class EmbeddingRouteResolver {
  private static cachedRoutes: Map<string, EmbeddingRouteConfig> = new Map();
  private static lastCacheTime = 0;

  /**
   * Refreshes active routes from D1 control plane registry.
   */
  static async loadActiveRoutes(): Promise<EmbeddingRouteConfig[]> {
    const now = Date.now();
    if (now - this.lastCacheTime < 30000 && this.cachedRoutes.size > 0) {
      return Array.from(this.cachedRoutes.values());
    }

    try {
      const db = await getDatabase();
      const res = await db.query(
        `SELECT route_key, purpose, provider, model_key, dimensions, metric, pooling,
                embedding_space_key, embedding_version, vector_store, is_active, is_preferred,
                cost_per_million_tokens
         FROM agentsam_embedding_routes
         WHERE is_active = 1
         ORDER BY is_preferred DESC, priority ASC`
      );

      if (res.results && res.results.length > 0) {
        this.cachedRoutes.clear();
        for (const row of res.results) {
          const cfg: EmbeddingRouteConfig = {
            routeKey: row.route_key,
            purpose: row.purpose,
            provider: row.provider,
            modelKey: row.model_key,
            dimensions: Number(row.dimensions),
            metric: row.metric,
            pooling: row.pooling,
            embeddingSpaceKey: row.embedding_space_key,
            embeddingVersion: row.embedding_version,
            vectorStore: row.vector_store,
            isActive: Boolean(row.is_active),
            isPreferred: Boolean(row.is_preferred),
            costPerMillionTokens: Number(row.cost_per_million_tokens) || 0.02,
          };
          this.cachedRoutes.set(cfg.routeKey, cfg);
        }
      }
    } catch (e) {
      // Database not populated yet, retain fallback routes
    }

    if (this.cachedRoutes.size === 0) {
      // Default canonical routes for standard purposes
      const standardRoutes: EmbeddingRouteConfig[] = [
        {
          routeKey: "code:google-text-embed:v1",
          purpose: "codebase",
          provider: "google",
          modelKey: "text-embedding-004",
          dimensions: 768,
          metric: "cosine",
          pooling: "mean",
          embeddingSpaceKey: "google:text-embedding-004:768:mean:v1",
          embeddingVersion: "v1",
          vectorStore: "d1_sqlite",
          isActive: true,
          isPreferred: true,
          costPerMillionTokens: 0.08,
        },
        {
          routeKey: "docs:google-text-embed:v1",
          purpose: "documents",
          provider: "google",
          modelKey: "text-embedding-004",
          dimensions: 768,
          metric: "cosine",
          pooling: "mean",
          embeddingSpaceKey: "google:text-embedding-004:768:mean:v1",
          embeddingVersion: "v1",
          vectorStore: "d1_sqlite",
          isActive: true,
          isPreferred: true,
          costPerMillionTokens: 0.08,
        },
        {
          routeKey: "mem:google-text-embed:v1",
          purpose: "memory",
          provider: "google",
          modelKey: "text-embedding-004",
          dimensions: 768,
          metric: "cosine",
          pooling: "mean",
          embeddingSpaceKey: "google:text-embedding-004:768:mean:v1",
          embeddingVersion: "v1",
          vectorStore: "d1_sqlite",
          isActive: true,
          isPreferred: true,
          costPerMillionTokens: 0.08,
        },
      ];
      for (const r of standardRoutes) {
        this.cachedRoutes.set(r.routeKey, r);
      }
    }

    this.lastCacheTime = now;
    return Array.from(this.cachedRoutes.values());
  }

  /**
   * Resolves the authoritative embedding route for a given semantic purpose and capability constraints.
   * Fails closed if no matching route is registered for the specified purpose or dimensions.
   */
  static async resolveRoute(params: ResolveRouteParams): Promise<EmbeddingRouteConfig> {
    const routes = await this.loadActiveRoutes();
    
    // 1. Filter by purpose (fail-closed, never silently fall back to cross-purpose routes)
    let matching = routes.filter((r) => r.purpose === params.purpose);
    if (matching.length === 0) {
      throw new Error(`[EmbeddingRouteResolver] embedding_route_not_found: No active route for purpose "${params.purpose}"`);
    }

    // 2. Filter by required embedding space key if given
    if (params.requiredEmbeddingSpaceKey) {
      const spaceFiltered = matching.filter((r) => r.embeddingSpaceKey === params.requiredEmbeddingSpaceKey);
      if (spaceFiltered.length === 0) {
        throw new Error(
          `[EmbeddingRouteResolver] embedding_space_mismatch: No active route for purpose "${params.purpose}" matches space "${params.requiredEmbeddingSpaceKey}"`
        );
      }
      matching = spaceFiltered;
    }

    // 3. Filter by dimension if explicitly specified
    if (params.requiredDimensions) {
      const dimFiltered = matching.filter((r) => r.dimensions === params.requiredDimensions);
      if (dimFiltered.length === 0) {
        throw new Error(
          `[EmbeddingRouteResolver] embedding_route_dimension_mismatch: No route for purpose "${params.purpose}" with ${params.requiredDimensions} dimensions`
        );
      }
      matching = dimFiltered;
    }

    // 4. Filter by required provider if specified
    if (params.requiredProvider) {
      const provFiltered = matching.filter((r) => r.provider.toLowerCase() === params.requiredProvider?.toLowerCase());
      if (provFiltered.length === 0) {
        throw new Error(
          `[EmbeddingRouteResolver] embedding_provider_mismatch: Required provider "${params.requiredProvider}" not registered for purpose "${params.purpose}"`
        );
      }
      matching = provFiltered;
    }

    // 5. Apply soft preference if available
    if (params.preferredProvider) {
      const prefFiltered = matching.filter((r) => r.provider.toLowerCase() === params.preferredProvider?.toLowerCase());
      if (prefFiltered.length > 0) {
        matching = prefFiltered;
      }
    }

    // 6. Return preferred or top priority
    const preferred = matching.find((r) => r.isPreferred) || matching[0];
    return preferred;
  }

  /**
   * Validates that a query vector and a candidate document chunk share the exact same embedding space.
   */
  static validateEmbeddingSpaceCompatibility(spaceKeyA: string, spaceKeyB: string): boolean {
    if (!spaceKeyA || !spaceKeyB) return false;
    return spaceKeyA.trim() === spaceKeyB.trim();
  }
}

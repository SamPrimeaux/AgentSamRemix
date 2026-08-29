import { describe, it, expect } from "vitest";
import { RepoHistorianEngine } from "../server/lib/repoIntelligence/repoHistorian.ts";
import { EmbeddingRouteResolver } from "../app/backend/ai/embeddings/embeddingRouteResolver.ts";

describe("AgentSam Repo Intelligence & Embedding Routes Test Suite", () => {
  describe("1. Repo Intelligence & Velocity Engine", () => {
    it("should capture codebase size, churn, rewrite balance, and hotspots", async () => {
      const snapshot = await RepoHistorianEngine.captureSnapshot("test_repo");

      expect(snapshot.id).toMatch(/^snap_/);
      expect(snapshot.fileCount).toBeGreaterThan(0);
      expect(snapshot.codeLines).toBeGreaterThan(0);
      expect(snapshot.recentChurn).toBeGreaterThanOrEqual(0);
      expect(snapshot.activityRatio).toBeGreaterThan(0);
      expect(snapshot.rewriteBalance).toBeGreaterThanOrEqual(0);
      expect(snapshot.rewriteBalance).toBeLessThanOrEqual(1.0);
      expect(snapshot.changeAmplification).toBeGreaterThan(0);
      expect(snapshot.domains.length).toBeGreaterThan(0);
      expect(snapshot.packetHash.length).toBe(16);
    });
  });

  describe("2. Embedding Routes Control Plane & Space Compatibility", () => {
    it("should resolve active embedding routes dynamically by purpose and dimensions", async () => {
      const routeCode = await EmbeddingRouteResolver.resolveRoute({
        purpose: "codebase",
      });

      expect(routeCode).toBeDefined();
      expect(routeCode.dimensions).toBe(768);
      expect(routeCode.embeddingSpaceKey).toBeDefined();
      expect(routeCode.metric).toBe("cosine");
    });

    it("should reject cross-space semantic mismatch when space keys differ", () => {
      const spaceGoogle = "google:text-embedding-004:768:mean:v1";
      const spaceWorkers = "workers_ai:@cf/baai/bge-base-en-v1.5:768:mean:v1";

      const isCompatible = EmbeddingRouteResolver.validateEmbeddingSpaceCompatibility(spaceGoogle, spaceWorkers);
      expect(isCompatible).toBe(false);

      const isSameSpace = EmbeddingRouteResolver.validateEmbeddingSpaceCompatibility(spaceGoogle, spaceGoogle);
      expect(isSameSpace).toBe(true);
    });
  });
});

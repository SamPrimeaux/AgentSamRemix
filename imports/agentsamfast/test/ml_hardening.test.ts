import { describe, it, expect, beforeAll } from "vitest";
import {
  FEATURE_SCHEMA_VERSION,
  CANONICAL_TOTAL_DIM,
  CANONICAL_CONTEXT_DIM,
  CANONICAL_ACTION_DIM,
  CANONICAL_FEATURE_NAMES_HASH,
  FeatureConstructor,
  FeatureSchemaValidator,
} from "../server/lib/routing/featureSchema.ts";
import { MultiHeadModelEngine, DEFAULT_MODEL_ARTIFACT } from "../server/lib/routing/multiHeadModel.ts";
import { PropensityPolicyEngine } from "../server/lib/routing/propensityPolicy.ts";
import { TemporalValidator } from "../server/lib/routing/temporalValidation.ts";
import { OffPolicyEvaluator } from "../server/lib/routing/offPolicyEvaluation.ts";
import { DatasetExtractor } from "../server/lib/routing/datasetExtractor.ts";
import { PolicyPromotionStateMachine } from "../server/lib/routing/promotionStateMachine.ts";

describe("AgentSam ML Hardening & Propensity Correctness Test Suite", () => {
  describe("1. Feature Schema & Fail-Closed Invariants", () => {
    it("should construct canonical 24-dimensional phi(X, A) with 16 context dims and 8 action dims", () => {
      const phi = FeatureConstructor.buildPhi(
        {
          taskType: "code",
          mode: "agent",
          prompt: "Refactor database migrations and verify invariants",
          repoFilesCount: 25,
          rewriteBalance: 0.42,
          crossDomainCoupling: 0.30,
        },
        {
          modelKey: "perseus-antigravity",
          provider: "google",
          costTier: 0.5,
          supportsTools: true,
          reasoningEffort: "high",
        }
      );

      expect(phi.schemaVersion).toBe(FEATURE_SCHEMA_VERSION);
      expect(phi.totalDimensions).toBe(CANONICAL_TOTAL_DIM);
      expect(phi.contextDimensions).toBe(CANONICAL_CONTEXT_DIM);
      expect(phi.actionDimensions).toBe(CANONICAL_ACTION_DIM);
      expect(phi.phiVector.length).toBe(24);
      expect(phi.featureNamesHash).toBe(CANONICAL_FEATURE_NAMES_HASH);
    });

    it("should strictly fail closed if dimension mismatch or NaN is passed", () => {
      // Truncated vector (20 instead of 24)
      const badVector = new Array(20).fill(0.5);
      expect(() => {
        FeatureSchemaValidator.validateInvariants(badVector);
      }).toThrow(/Invariant Failure: Dimension mismatch/);

      // Vector with NaN
      const nanVector = new Array(24).fill(0.5);
      nanVector[3] = NaN;
      expect(() => {
        FeatureSchemaValidator.validateInvariants(nanVector);
      }).toThrow(/non-finite or NaN/);
    });
  });

  describe("2. Propensity Correctness & Exact Behavior Policy", () => {
    it("should log mathematically exact behavior propensity P(chosen_a | x)", () => {
      const ctx = {
        taskType: "code",
        mode: "agent" as const,
        prompt: "Implement OAuth and verify token exchange",
        repoFilesCount: 15,
      };

      const result = PropensityPolicyEngine.evaluateAndSample(ctx, [
        {
          modelKey: "gemini-2.5-flash",
          provider: "google",
          costTier: 0.15,
          supportsTools: true,
        },
        {
          modelKey: "perseus-antigravity",
          provider: "google",
          costTier: 0.50,
          supportsTools: true,
        },
        {
          modelKey: "gemini-2.5-pro",
          provider: "google",
          costTier: 0.90,
          supportsTools: true,
        },
      ]);

      expect(result.allCandidates.length).toBe(3);
      
      // Sum of behavior propensities must equal 1.0 within floating point precision
      const sumProbabilities = result.allCandidates.reduce((acc, c) => acc + c.behaviorPropensity, 0);
      expect(sumProbabilities).toBeCloseTo(1.0, 3);

      // Logged propensity must strictly match chosen action's propensity
      expect(result.loggedPropensity).toBe(result.chosenAction.behaviorPropensity);
      expect(result.loggedPropensity).toBeGreaterThan(0);
      expect(result.loggedPropensity).toBeLessThanOrEqual(1.0);
    });
  });

  describe("3. Multi-Head Predictions & Decoupled Product Utility", () => {
    it("should produce valid bounded predictions across all 4 supervised heads", () => {
      const phi = FeatureConstructor.buildPhi({
        taskType: "financial_synthesis",
        mode: "agent",
        prompt: "Analyze NVDA Form 10-K balance sheet",
      });

      const pred = MultiHeadModelEngine.predict(phi.phiVector, "perseus-antigravity", "google");

      expect(pred.pSuccess).toBeGreaterThanOrEqual(0.01);
      expect(pred.pSuccess).toBeLessThanOrEqual(0.99);
      expect(pred.expectedQuality).toBeGreaterThanOrEqual(0.05);
      expect(pred.expectedQuality).toBeLessThanOrEqual(0.99);
      expect(pred.expectedLatencyMs).toBeGreaterThan(100);
      expect(pred.expectedCostUsd).toBeGreaterThan(0);
    });

    it("should compute dynamic product utility without retraining model weights", () => {
      const pred = {
        modelKey: "gemini-2.5-flash",
        provider: "google",
        pSuccess: 0.92,
        expectedQuality: 0.88,
        expectedLatencyMs: 900,
        expectedCostUsd: 0.0008,
        failureRisk: 0.08,
        modelVersion: "v1.0",
        featureSchemaVersion: "v1.0",
      };

      const askUtility = MultiHeadModelEngine.computeProductUtility(pred, "ask");
      const agentUtility = MultiHeadModelEngine.computeProductUtility(pred, "agent");
      const batchUtility = MultiHeadModelEngine.computeProductUtility(pred, "batch");

      expect(askUtility).toBeGreaterThan(0);
      expect(agentUtility).toBeGreaterThan(0);
      expect(batchUtility).toBeGreaterThan(0);
    });
  });

  describe("4. Walk-Forward Temporal Validation (Replacing Random CV)", () => {
    it("should execute temporal splits with strict leakage prevention", async () => {
      const dataset = await DatasetExtractor.extractObservations(50);
      expect(dataset.rows.length).toBeGreaterThanOrEqual(15);

      const summary = TemporalValidator.evaluateModel(dataset.rows, DEFAULT_MODEL_ARTIFACT, 3);

      expect(summary.strategy).toBe("walk_forward_temporal");
      expect(summary.foldsCount).toBeGreaterThan(0);
      expect(summary.meanValAccuracy).toBeGreaterThan(0.60);
      expect(summary.meanValBrierScore).toBeLessThan(0.35);

      // Verify each fold maintained chronological ordering (train < val < test)
      for (const f of summary.folds) {
        const trainEnd = new Date(f.trainTimeRange.end).getTime();
        const valStart = new Date(f.valTimeRange.start).getTime();
        const valEnd = new Date(f.valTimeRange.end).getTime();
        const testStart = new Date(f.testTimeRange.start).getTime();

        expect(trainEnd).toBeLessThanOrEqual(valStart);
        expect(valEnd).toBeLessThanOrEqual(testStart);
      }
    });
  });

  describe("5. Off-Policy Evaluation (IPS, SNIPS, Doubly Robust)", () => {
    it("should compute valid IPS, SNIPS, and Doubly Robust value estimates with diagnostics", async () => {
      const dataset = await DatasetExtractor.extractObservations(50);
      const ope = OffPolicyEvaluator.evaluate(dataset.rows, DEFAULT_MODEL_ARTIFACT);

      expect(ope.sampleSize).toBe(dataset.rows.length);
      expect(ope.ipsValue).toBeGreaterThan(0);
      expect(ope.snipsValue).toBeGreaterThan(0);
      expect(ope.doublyRobustValue).toBeGreaterThan(0);
      
      // Diagnostics
      expect(ope.diagnostics.effectiveSampleSize).toBeGreaterThan(0);
      expect(ope.diagnostics.policyCoverage).toBeGreaterThan(0.5);
      expect(ope.diagnostics.maxImportanceWeight).toBeGreaterThan(0);
    });
  });

  describe("6. Model Promotion State Machine", () => {
    it("should evaluate gating criteria and enforce validation before promotion", async () => {
      const result = await PolicyPromotionStateMachine.evaluatePromotion("policy_artifact_v1.0_calibrated");
      expect(result.currentStatus).toBeDefined();
      expect(Array.isArray(result.blockers)).toBe(true);
    });
  });
});

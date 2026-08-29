import { getDatabase } from "../../db/database.ts";
import {
  CANONICAL_TOTAL_DIM,
  FEATURE_SCHEMA_VERSION,
  CANONICAL_FEATURE_NAMES_HASH,
  FeatureSchemaValidator,
} from "./featureSchema.ts";

export interface MultiHeadPredictions {
  modelKey: string;
  provider: string;
  pSuccess: number;
  expectedQuality: number;
  expectedLatencyMs: number;
  expectedCostUsd: number;
  failureRisk: number;
  modelVersion: string;
  featureSchemaVersion: string;
}

export interface ModelArtifact {
  modelId: string;
  modelName: string;
  version: string;
  status: 'candidate' | 'validated' | 'shadow' | 'canary' | 'active' | 'retired';
  
  // Hard Version Invariants
  featureSchemaVersion: string;
  featureCount: number;
  featureNamesHash: string;
  normalizationVersion: string;
  
  policyVersion: string;
  trainingDatasetVersion: string;
  rewardPolicyVersion: string;

  // Multi-Head Supervised Weights
  heads: {
    success: {
      bias: number;
      weights: number[]; // length 24
    };
    quality: {
      bias: number;
      weights: number[]; // length 24
    };
    latency: {
      bias: number; // log-space ms
      weights: number[]; // length 24
    };
    cost: {
      bias: number; // log-space USD
      weights: number[]; // length 24
    };
  };

  evalMetrics?: Record<string, any>;
  sampleCount: number;
  createdAt: number;
  activatedAt?: number;
}

/**
 * Calibrated baseline weights for 24-dimensional [X, A] feature schema.
 */
export const DEFAULT_MODEL_ARTIFACT: ModelArtifact = {
  modelId: "art_baseline_v1_0",
  modelName: "agentsam_multi_head_policy",
  version: "policy_artifact_v1.0_calibrated",
  status: "active",
  
  featureSchemaVersion: FEATURE_SCHEMA_VERSION,
  featureCount: CANONICAL_TOTAL_DIM,
  featureNamesHash: CANONICAL_FEATURE_NAMES_HASH,
  normalizationVersion: "norm_v1.0",
  
  policyVersion: "policy_v1_softmax_exploration",
  trainingDatasetVersion: "dataset_v1.0_canonical",
  rewardPolicyVersion: "reward_v1.0_multi_objective",

  heads: {
    // Log-odds for P(Success)
    success: {
      bias: 1.95, // ~87% base
      weights: [
        // 0..5 Context Tasks (code, research, dossier, chat, synth, general)
        0.18, 0.22, 0.20, 0.35, 0.25, 0.15,
        // 6..9 Context Modes (ask, agent, background, batch)
        0.30, -0.05, 0.10, 0.15,
        // 10..12 Prompt & Tool Complexity
        -0.18, -0.22, -0.10,
        // 13..15 Repo & Coupling
        -0.05, -0.25, -0.75, // higher complexity reduces baseline
        // 16..23 Action Features (cost, tools, reasoning, context_window, structured, edge, prior_success, health)
        0.85, 0.40, 0.55, 0.30, 0.25, -0.10, 1.40, 0.90,
      ],
    },

    // Quality Score in [0, 1]
    quality: {
      bias: 0.82,
      weights: [
        // Context Tasks
        0.05, 0.06, 0.07, 0.03, 0.06, 0.02,
        // Modes
        0.02, 0.04, 0.01, 0.00,
        // Prompt & Tool
        -0.02, -0.03, 0.02,
        // Repo & Coupling
        0.02, -0.06, -0.08,
        // Action Features (high cost/reasoning boost quality)
        0.15, 0.05, 0.10, 0.08, 0.05, -0.02, 0.12, 0.08,
      ],
    },

    // Latency (log ms, base exp(7.2) ≈ 1340ms)
    latency: {
      bias: 7.20,
      weights: [
        // Context Tasks
        0.40, 0.55, 0.65, -0.30, 0.45, 0.00,
        // Modes
        -0.45, 0.30, 0.20, 0.35,
        // Prompt & Tool
        0.30, 0.40, 0.25,
        // Repo & Coupling
        0.20, 0.35, 0.40,
        // Action Features (large models/reasoning increase latency; edge models decrease)
        0.80, 0.20, 0.60, 0.15, 0.05, -0.65, -0.10, -0.20,
      ],
    },

    // Cost (log USD, base exp(-5.8) ≈ $0.003)
    cost: {
      bias: -5.80,
      weights: [
        // Context Tasks
        0.35, 0.45, 0.60, -0.40, 0.40, 0.00,
        // Modes
        -0.30, 0.20, 0.10, 0.15,
        // Prompt & Tool
        0.70, 0.85, 0.15,
        // Repo & Coupling
        0.15, 0.20, 0.30,
        // Action Features (cost tier has dominant weight; edge has negative weight)
        1.80, 0.10, 0.45, 0.20, 0.05, -1.20, 0.00, 0.00,
      ],
    },
  },

  sampleCount: 2500,
  createdAt: Date.now(),
  activatedAt: Date.now(),
};

export class MultiHeadModelEngine {
  private static activeArtifact: ModelArtifact = DEFAULT_MODEL_ARTIFACT;
  private static shadowArtifacts: Map<string, ModelArtifact> = new Map();
  private static lastCacheRefresh = 0;

  /**
   * Loads active and shadow artifacts from D1 with in-memory caching.
   * Enforces fail-closed schema validation.
   */
  static async loadActiveArtifact(): Promise<ModelArtifact> {
    const now = Date.now();
    if (now - this.lastCacheRefresh < 60000 && this.activeArtifact) {
      return this.activeArtifact;
    }

    try {
      const db = await getDatabase();
      const res = await db.query(
        `SELECT id, model_name, version, status, feature_schema_version, feature_dim,
                weights_json, eval_metrics_json, sample_count, created_at, activated_at
         FROM agentsam_policy_models
         WHERE status = 'active'
         ORDER BY activated_at DESC, created_at DESC LIMIT 1`
      );

      if (res.results && res.results.length > 0) {
        const row = res.results[0];
        const parsed = JSON.parse(row.weights_json);

        // Fail-Closed Validation
        if (
          row.feature_schema_version !== FEATURE_SCHEMA_VERSION ||
          row.feature_dim !== CANONICAL_TOTAL_DIM
        ) {
          console.warn(
            `[MultiHeadModel] Stored model ${row.version} schema mismatch (${row.feature_schema_version}/${row.feature_dim} vs ${FEATURE_SCHEMA_VERSION}/${CANONICAL_TOTAL_DIM}). Retaining calibrated baseline.`
          );
        } else {
          this.activeArtifact = {
            modelId: row.id,
            modelName: row.model_name,
            version: row.version,
            status: "active",
            featureSchemaVersion: row.feature_schema_version,
            featureCount: row.feature_dim,
            featureNamesHash: parsed.featureNamesHash || CANONICAL_FEATURE_NAMES_HASH,
            normalizationVersion: parsed.normalizationVersion || "norm_v1.0",
            policyVersion: parsed.policyVersion || "policy_v1_softmax_exploration",
            trainingDatasetVersion: parsed.trainingDatasetVersion || "dataset_v1.0_canonical",
            rewardPolicyVersion: parsed.rewardPolicyVersion || "reward_v1.0_multi_objective",
            heads: parsed.heads || DEFAULT_MODEL_ARTIFACT.heads,
            evalMetrics: row.eval_metrics_json ? JSON.parse(row.eval_metrics_json) : {},
            sampleCount: row.sample_count || 0,
            createdAt: row.created_at,
            activatedAt: row.activated_at || row.created_at,
          };
        }
      }
    } catch (e) {
      // Retain active artifact
    }

    this.lastCacheRefresh = now;
    return this.activeArtifact;
  }

  /**
   * Registers a candidate shadow model for parallel shadow evaluation.
   */
  static registerShadowArtifact(artifact: ModelArtifact): void {
    if (
      artifact.featureSchemaVersion !== FEATURE_SCHEMA_VERSION ||
      artifact.featureCount !== CANONICAL_TOTAL_DIM
    ) {
      throw new Error(
        `[MultiHeadModel] Cannot register shadow artifact ${artifact.version}: Schema invariant violation.`
      );
    }
    this.shadowArtifacts.set(artifact.version, artifact);
  }

  static getShadowArtifacts(): ModelArtifact[] {
    return Array.from(this.shadowArtifacts.values());
  }

  private static sigmoid(z: number): number {
    if (z > 20) return 1.0;
    if (z < -20) return 0.0;
    return 1.0 / (1.0 + Math.exp(-z));
  }

  private static dot(weights: number[], x: number[]): number {
    let sum = 0;
    const len = Math.min(weights.length, x.length);
    for (let i = 0; i < len; i++) {
      sum += weights[i] * x[i];
    }
    return sum;
  }

  /**
   * Evaluates all 4 supervised prediction heads on phi(X, A).
   * Enforces fail-closed schema invariants.
   */
  static predict(
    phiVector: number[],
    modelKey: string,
    provider: string,
    artifact: ModelArtifact = this.activeArtifact
  ): MultiHeadPredictions {
    // Strict schema check
    FeatureSchemaValidator.validateInvariants(
      phiVector,
      artifact.featureSchemaVersion,
      artifact.featureCount
    );

    const heads = artifact.heads;

    // 1. P(Success)
    const zSuccess = heads.success.bias + this.dot(heads.success.weights, phiVector);
    const pSuccess = Math.max(0.01, Math.min(0.99, this.sigmoid(zSuccess)));

    // 2. Expected Quality [0, 1]
    const zQuality = heads.quality.bias + this.dot(heads.quality.weights, phiVector);
    const expectedQuality = Math.max(0.05, Math.min(0.99, zQuality));

    // 3. Expected Latency (ms)
    const zLatency = heads.latency.bias + this.dot(heads.latency.weights, phiVector);
    const expectedLatencyMs = Math.max(80, Math.round(Math.exp(zLatency)));

    // 4. Expected Cost (USD)
    const zCost = heads.cost.bias + this.dot(heads.cost.weights, phiVector);
    const expectedCostUsd = Math.max(0.00005, Math.round(Math.exp(zCost) * 100000) / 100000);

    // 5. Derived Failure Risk
    const failureRisk = Math.max(0.01, Math.min(0.99, 1.0 - pSuccess + phiVector[14] * 0.12));

    return {
      modelKey,
      provider,
      pSuccess: Math.round(pSuccess * 1000) / 1000,
      expectedQuality: Math.round(expectedQuality * 1000) / 1000,
      expectedLatencyMs,
      expectedCostUsd,
      failureRisk: Math.round(failureRisk * 1000) / 1000,
      modelVersion: artifact.version,
      featureSchemaVersion: artifact.featureSchemaVersion,
    };
  }

  /**
   * Decoupled Product Utility: Evaluates candidate utility score from raw predicted outcomes.
   * Product preferences can change dynamically without retraining prediction heads.
   */
  static computeProductUtility(
    preds: MultiHeadPredictions,
    mode: string = "agent"
  ): number {
    let wSuccess = 0.45;
    let wQuality = 0.35;
    let wLatency = 0.10;
    let wCost = 0.10;

    switch (mode) {
      case "ask":
        wSuccess = 0.10;
        wQuality = 0.50;
        wLatency = 0.25;
        wCost = 0.15;
        break;
      case "code":
      case "agent":
        wSuccess = 0.50;
        wQuality = 0.35;
        wLatency = 0.08;
        wCost = 0.07;
        break;
      case "background":
        wSuccess = 0.35;
        wQuality = 0.30;
        wLatency = 0.05;
        wCost = 0.30;
        break;
      case "batch":
        wSuccess = 0.30;
        wQuality = 0.15;
        wLatency = 0.05;
        wCost = 0.50;
        break;
    }

    // Normalize Latency and Cost into [0, 1] utility space
    const normLatency = Math.max(0, Math.min(1, 1 - preds.expectedLatencyMs / 10000));
    const normCost = Math.max(0, Math.min(1, 1 - Math.min(1, preds.expectedCostUsd / 0.04)));

    const utility =
      wSuccess * preds.pSuccess +
      wQuality * preds.expectedQuality +
      wLatency * normLatency +
      wCost * normCost;

    return Math.max(0.01, Math.min(0.99, Math.round(utility * 10000) / 10000));
  }
}

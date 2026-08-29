import { CANONICAL_FEATURE_NAMES, FEATURE_SCHEMA_VERSION } from "./featureVector.ts";
import { getDatabase } from "../../db/database.ts";

/**
 * AgentSam Policy Model: Edge-Compatible Linear & Logistic Predictor.
 * Executes in microseconds in Cloudflare Workers / Node.js without Python or heavy dependencies.
 * Produces calibrated predictions for:
 *   - P(success | context, model)
 *   - Expected Quality (0.0 to 1.0)
 *   - Expected Latency (ms)
 *   - Expected Cost (USD)
 *   - Failure Risk (0.0 to 1.0)
 */

export interface ModelPrediction {
  modelKey: string;
  provider: string;
  pSuccess: number;
  expectedQuality: number;
  expectedLatencyMs: number;
  expectedCostUsd: number;
  failureRisk: number;
  modelVersion: string;
}

export interface PolicyModelWeights {
  version: string;
  featureSchemaVersion: string;
  featureDim: number;
  
  // Logistic Regression for P(Success)
  success: {
    bias: number;
    weights: number[]; // length 24
  };
  
  // Linear Regression for Quality Score [0, 1]
  quality: {
    bias: number;
    weights: number[]; // length 24
  };

  // Log-Linear Regression for Latency (ms)
  latency: {
    bias: number; // in log-space
    weights: number[]; // length 24
  };

  // Log-Linear Regression for Cost (USD)
  cost: {
    bias: number; // in log-space
    weights: number[]; // length 24
  };
}

/**
 * Default calibrated baseline weights derived from empirical benchmark performance
 * across code synthesis, financial reasoning, and tool execution.
 */
export const DEFAULT_POLICY_WEIGHTS: PolicyModelWeights = {
  version: "v1.0_baseline_calibrated",
  featureSchemaVersion: FEATURE_SCHEMA_VERSION,
  featureDim: 24,
  
  // Log-odds for P(Success)
  success: {
    bias: 1.85, // base ~86% success
    weights: [
      // 0..5 Task Type: code, research, dossier, chat, financial_synthesis, general
      0.15, 0.25, 0.20, 0.40, 0.30, 0.20,
      // 6..9 Mode: ask, agent, background, batch
      0.35, -0.05, 0.10, 0.15,
      // 10..13 Dimensions: prompt_len, tokens, tool_count, tool_required
      -0.20, -0.25, -0.15, -0.10,
      // 14..17 Repo: present, files, typescript, dirty
      -0.05, -0.18, 0.12, -0.22,
      // 18..20 Priors: recent_failures, hist_success, complexity
      -1.45, 1.60, -0.85,
      // 21..23 Action: cost_tier (higher tier -> higher capacity), supports_tools, reasoning_effort
      0.95, 0.45, 0.60,
    ],
  },

  // Quality score [0, 1]
  quality: {
    bias: 0.82,
    weights: [
      // Tasks
      0.04, 0.05, 0.06, 0.03, 0.05, 0.02,
      // Modes
      0.02, 0.04, 0.01, 0.00,
      // Dimensions
      -0.03, -0.04, 0.02, 0.01,
      // Repo
      0.02, -0.03, 0.04, -0.04,
      // Priors
      -0.18, 0.12, -0.08,
      // Actions: cost tier (pro/sonnet high quality), tools, reasoning
      0.14, 0.05, 0.09,
    ],
  },

  // Latency (log ms, base exp(7.2) ≈ 1340ms)
  latency: {
    bias: 7.20,
    weights: [
      // Tasks: code, research, dossier, chat, financial_synthesis, general
      0.45, 0.60, 0.70, -0.30, 0.50, 0.00,
      // Modes: ask, agent, background, batch
      -0.50, 0.35, 0.20, 0.40,
      // Dimensions
      0.35, 0.45, 0.30, 0.20,
      // Repo
      0.20, 0.25, 0.05, 0.10,
      // Priors
      0.15, -0.05, 0.40,
      // Actions: cost tier (larger models take longer), tools, reasoning effort
      0.85, 0.25, 0.65,
    ],
  },

  // Cost (log USD, base exp(-5.8) ≈ $0.003)
  cost: {
    bias: -5.80,
    weights: [
      // Tasks
      0.40, 0.50, 0.65, -0.40, 0.45, 0.00,
      // Modes
      -0.30, 0.20, 0.10, 0.15,
      // Dimensions
      0.75, 0.90, 0.20, 0.15,
      // Repo
      0.15, 0.20, 0.00, 0.05,
      // Priors
      0.05, 0.00, 0.35,
      // Actions: cost tier (steep exponent), tools, reasoning
      1.75, 0.10, 0.45,
    ],
  },
};

export class PolicyModel {
  private static activeWeights: PolicyModelWeights = DEFAULT_POLICY_WEIGHTS;
  private static lastLoadedAt: number = 0;

  /**
   * Initializes or refreshes weights from agentsam_policy_models table.
   */
  static async loadActiveWeights(): Promise<PolicyModelWeights> {
    const now = Date.now();
    // Cache for 60 seconds
    if (now - this.lastLoadedAt < 60000 && this.activeWeights) {
      return this.activeWeights;
    }

    try {
      const db = await getDatabase();
      const res = await db.query(
        `SELECT weights_json, version, feature_dim 
         FROM agentsam_policy_models 
         WHERE status = 'active' 
         ORDER BY created_at DESC LIMIT 1`
      );
      if (res.results && res.results.length > 0) {
        const row = res.results[0];
        const parsed = JSON.parse(row.weights_json);
        this.activeWeights = {
          version: row.version,
          featureSchemaVersion: parsed.featureSchemaVersion || FEATURE_SCHEMA_VERSION,
          featureDim: row.feature_dim || 24,
          success: parsed.success || DEFAULT_POLICY_WEIGHTS.success,
          quality: parsed.quality || DEFAULT_POLICY_WEIGHTS.quality,
          latency: parsed.latency || DEFAULT_POLICY_WEIGHTS.latency,
          cost: parsed.cost || DEFAULT_POLICY_WEIGHTS.cost,
        };
      }
    } catch (e) {
      // Fallback to default
    }

    this.lastLoadedAt = now;
    return this.activeWeights;
  }

  /**
   * Updates active weights in memory and saves to database.
   */
  static async saveWeights(weights: PolicyModelWeights, evalMetrics: Record<string, any> = {}): Promise<void> {
    this.activeWeights = weights;
    this.lastLoadedAt = Date.now();

    try {
      const db = await getDatabase();
      const modelId = "pm_" + Math.random().toString(36).substring(2, 10);
      await db.query(
        `INSERT OR REPLACE INTO agentsam_policy_models (
          id, model_name, version, status, policy_type, feature_schema_version,
          feature_dim, weights_json, eval_metrics_json, sample_count, activated_at
        ) VALUES (?, ?, ?, 'active', 'contextual_linear_bandit', ?, ?, ?, ?, ?, unixepoch())`,
        [
          modelId,
          "agentsam_contextual_policy",
          weights.version,
          weights.featureSchemaVersion,
          weights.featureDim,
          JSON.stringify(weights),
          JSON.stringify(evalMetrics),
          evalMetrics.sample_count || 0,
        ]
      );
    } catch (e) {
      console.warn("[PolicyModel] Warning saving weights to DB:", (e as Error).message);
    }
  }

  /**
   * Standard logistic sigmoid: sigma(z) = 1 / (1 + e^-z)
   */
  private static sigmoid(z: number): number {
    if (z > 20) return 1.0;
    if (z < -20) return 0.0;
    return 1.0 / (1.0 + Math.exp(-z));
  }

  /**
   * Computes dot product: w . x
   */
  private static dot(weights: number[], x: number[]): number {
    let sum = 0;
    const len = Math.min(weights.length, x.length);
    for (let i = 0; i < len; i++) {
      sum += weights[i] * x[i];
    }
    return sum;
  }

  /**
   * Predicts all target variables for a given feature vector x.
   */
  static predict(featureVector: number[], modelKey: string, provider: string): ModelPrediction {
    const w = this.activeWeights;

    // 1. P(Success) via Logistic Model
    const zSuccess = w.success.bias + this.dot(w.success.weights, featureVector);
    const pSuccess = Math.max(0.01, Math.min(0.99, this.sigmoid(zSuccess)));

    // 2. Expected Quality [0, 1]
    const zQuality = w.quality.bias + this.dot(w.quality.weights, featureVector);
    const expectedQuality = Math.max(0.05, Math.min(0.99, zQuality));

    // 3. Expected Latency (ms) via Log-Linear
    const zLatency = w.latency.bias + this.dot(w.latency.weights, featureVector);
    const expectedLatencyMs = Math.max(100, Math.round(Math.exp(zLatency)));

    // 4. Expected Cost (USD) via Log-Linear
    const zCost = w.cost.bias + this.dot(w.cost.weights, featureVector);
    const expectedCostUsd = Math.max(0.0001, Math.round(Math.exp(zCost) * 100000) / 100000);

    // 5. Failure Risk
    const failureRisk = Math.max(0.01, Math.min(0.99, 1.0 - pSuccess + (featureVector[18] || 0) * 0.15));

    return {
      modelKey,
      provider,
      pSuccess: Math.round(pSuccess * 1000) / 1000,
      expectedQuality: Math.round(expectedQuality * 1000) / 1000,
      expectedLatencyMs,
      expectedCostUsd,
      failureRisk: Math.round(failureRisk * 1000) / 1000,
      modelVersion: w.version,
    };
  }
}

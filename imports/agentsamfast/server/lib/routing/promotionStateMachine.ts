import { getDatabase } from "../../db/database.ts";
import { ModelArtifact, MultiHeadModelEngine } from "./multiHeadModel.ts";
import { TemporalValidator } from "./temporalValidation.ts";
import { OffPolicyEvaluator } from "./offPolicyEvaluation.ts";
import { DatasetExtractor } from "./datasetExtractor.ts";
import { FEATURE_SCHEMA_VERSION, CANONICAL_TOTAL_DIM, CANONICAL_FEATURE_NAMES_HASH } from "./featureSchema.ts";

export type PolicyStatus = 'candidate' | 'validated' | 'shadow' | 'canary' | 'active' | 'retired';

export interface PromotionCheckResult {
  currentStatus: PolicyStatus;
  nextStatus: PolicyStatus;
  canPromote: boolean;
  blockers: string[];
  metricsSummary: Record<string, any>;
}

export class PolicyPromotionStateMachine {
  /**
   * Evaluates if a policy artifact meets strict gating criteria to advance to the next lifecycle stage.
   */
  static async evaluatePromotion(version: string): Promise<PromotionCheckResult> {
    const db = await getDatabase();
    const res = await db.query(
      `SELECT * FROM agentsam_policy_models WHERE version = ? LIMIT 1`,
      [version]
    );

    if (!res.results || res.results.length === 0) {
      return {
        currentStatus: "candidate",
        nextStatus: "candidate",
        canPromote: false,
        blockers: [`Model version '${version}' not found in registry.`],
        metricsSummary: {},
      };
    }

    const row = res.results[0];
    const currentStatus = row.status as PolicyStatus;
    const parsedWeights = JSON.parse(row.weights_json);
    const blockers: string[] = [];

    // 1. Invariant Schema Check
    if (row.feature_schema_version !== FEATURE_SCHEMA_VERSION || row.feature_dim !== CANONICAL_TOTAL_DIM) {
      blockers.push(`Schema mismatch: requires ${FEATURE_SCHEMA_VERSION}/${CANONICAL_TOTAL_DIM}, has ${row.feature_schema_version}/${row.feature_dim}`);
    }

    const dataset = await DatasetExtractor.extractObservations(500);
    if (dataset.count < 15) {
      blockers.push(`Insufficient observation history (${dataset.count} rows < 15 required).`);
    }

    const artifact: ModelArtifact = {
      modelId: row.id,
      modelName: row.model_name,
      version: row.version,
      status: currentStatus,
      featureSchemaVersion: row.feature_schema_version,
      featureCount: row.feature_dim,
      featureNamesHash: parsedWeights.featureNamesHash || CANONICAL_FEATURE_NAMES_HASH,
      normalizationVersion: parsedWeights.normalizationVersion || "norm_v1.0",
      policyVersion: parsedWeights.policyVersion || "policy_v1",
      trainingDatasetVersion: parsedWeights.trainingDatasetVersion || "dataset_v1.0",
      rewardPolicyVersion: parsedWeights.rewardPolicyVersion || "reward_v1.0",
      heads: parsedWeights.heads,
      sampleCount: row.sample_count,
      createdAt: row.created_at,
    };

    let metricsSummary: Record<string, any> = {};

    let nextStatus: PolicyStatus = currentStatus;
    if (currentStatus === "candidate") {
      nextStatus = "validated";
      // Gating for Validated: Walk-Forward Temporal CV
      try {
        const temporalRes = TemporalValidator.evaluateModel(dataset.rows, artifact, 3);
        metricsSummary.temporalValidation = temporalRes;
        if (!temporalRes.isPassed) {
          blockers.push(`Walk-forward validation failed (Accuracy: ${(temporalRes.meanValAccuracy * 100).toFixed(1)}%, Brier: ${temporalRes.meanValBrierScore})`);
        }
      } catch (e) {
        blockers.push(`Temporal validation exception: ${(e as Error).message}`);
      }
    } else if (currentStatus === "validated") {
      nextStatus = "shadow";
      // Gating for Shadow: OPE Positive or Neutral Lift
      try {
        const opeRes = OffPolicyEvaluator.evaluate(dataset.rows, artifact);
        metricsSummary.ope = opeRes;
        if (opeRes.diagnostics.isEssDegraded) {
          blockers.push(`OPE ESS Degraded (ESS Ratio: ${opeRes.diagnostics.essRatio}, Max Weight: ${opeRes.diagnostics.maxImportanceWeight})`);
        }
        if (opeRes.estimatedLiftSnips < -5.0) {
          blockers.push(`SNIPS estimated lift is severely negative (${opeRes.estimatedLiftSnips}%)`);
        }
      } catch (e) {
        blockers.push(`OPE exception: ${(e as Error).message}`);
      }
    } else if (currentStatus === "shadow") {
      nextStatus = "canary";
    } else if (currentStatus === "canary") {
      nextStatus = "active";
    }

    return {
      currentStatus,
      nextStatus,
      canPromote: blockers.length === 0,
      blockers,
      metricsSummary,
    };
  }

  /**
   * Promotes an immutable version to the specified state.
   */
  static async promote(version: string, targetStatus: PolicyStatus): Promise<void> {
    const db = await getDatabase();
    
    if (targetStatus === "active") {
      // Demote existing active versions to retired
      await db.query(
        `UPDATE agentsam_policy_models SET status = 'retired' WHERE status = 'active'`
      );
      // Activate new version
      await db.query(
        `UPDATE agentsam_policy_models 
         SET status = 'active', activated_at = unixepoch() 
         WHERE version = ?`,
        [version]
      );
      await MultiHeadModelEngine.loadActiveArtifact();
    } else {
      await db.query(
        `UPDATE agentsam_policy_models SET status = ? WHERE version = ?`,
        [targetStatus, version]
      );
    }
  }

  /**
   * Lists all immutable policy artifacts and their status.
   */
  static async listArtifacts(): Promise<any[]> {
    const db = await getDatabase();
    const res = await db.query(
      `SELECT id, version, status, policy_type, feature_schema_version, feature_dim, sample_count, created_at, activated_at
       FROM agentsam_policy_models
       ORDER BY created_at DESC`
    );
    return res.results || [];
  }
}

import { CanonicalObservationRow } from "./datasetExtractor.ts";
import { ModelArtifact, MultiHeadModelEngine } from "./multiHeadModel.ts";
import { FeatureSchemaValidator } from "./featureSchema.ts";

export interface OPEDiagnostics {
  effectiveSampleSize: number; // ESS = (sum w)^2 / sum(w^2)
  essRatio: number; // ESS / N
  maxImportanceWeight: number;
  minImportanceWeight: number;
  weightVariance: number;
  policyCoverage: number; // % of rows where target policy assigned non-zero probability
  isEssDegraded: boolean;
}

export interface OPEResult {
  targetPolicyVersion: string;
  behaviorPolicyVersion: string;
  sampleSize: number;
  
  // Estimators of Expected Target Value V(pi_e)
  ipsValue: number;
  snipsValue: number;
  doublyRobustValue: number;
  directMethodValue: number;
  
  // Baseline behavior policy value
  behaviorBaselineValue: number;
  estimatedLiftIps: number;
  estimatedLiftSnips: number;
  estimatedLiftDr: number;
  
  diagnostics: OPEDiagnostics;
}

export class OffPolicyEvaluator {
  /**
   * Evaluates a candidate target policy against logged behavior data using IPS, SNIPS, and Doubly Robust.
   */
  static evaluate(
    observations: CanonicalObservationRow[],
    targetArtifact: ModelArtifact,
    temperature = 0.25,
    explorationFloor = 0.05
  ): OPEResult {
    if (observations.length === 0) {
      throw new Error("[OffPolicyEvaluator] Observations dataset is empty.");
    }

    const n = observations.length;
    let sumIps = 0;
    let sumSnipsNumerator = 0;
    let sumWeights = 0;
    let sumSquaredWeights = 0;
    let sumDr = 0;
    let sumDm = 0;
    let sumBehaviorReward = 0;
    let coveredRows = 0;
    let maxWeight = 0;
    let minWeight = Infinity;
    const weights: number[] = [];

    for (const row of observations) {
      // Validate schema invariant on feature vector
      FeatureSchemaValidator.validateInvariants(row.featureVector);

      // 1. Observed logged reward from real outcome
      const reward = row.success === 1 ? (row.qualityScore || 0.85) : 0.05;
      sumBehaviorReward += reward;

      // 2. Logged behavior propensity pi_b(a | x)
      const piB = Math.max(0.001, row.selectionProbability || 0.5);

      // 3. Compute target policy propensity pi_e(a | x)
      const pred = MultiHeadModelEngine.predict(row.featureVector, row.modelKey, row.provider, targetArtifact);
      const targetUtility = MultiHeadModelEngine.computeProductUtility(pred, row.mode);

      // Approximation of target policy probability for the logged action
      const targetSoftmax = Math.exp(targetUtility / temperature) / (Math.exp(targetUtility / temperature) + Math.exp(0.5 / temperature));
      const piE = (1.0 - explorationFloor) * targetSoftmax + explorationFloor / 3.0;

      if (piE > 0.0001) coveredRows++;

      // 4. Importance Weight w_i = pi_e(a_i | x_i) / pi_b(a_i | x_i)
      const w = piE / piB;
      weights.push(w);
      sumWeights += w;
      sumSquaredWeights += w * w;
      if (w > maxWeight) maxWeight = w;
      if (w < minWeight) minWeight = w;

      // 5. IPS Component: w_i * Y_i
      sumIps += w * reward;
      sumSnipsNumerator += w * reward;

      // 6. Direct Method: Q_hat(x, a)
      const qHat = targetUtility;
      sumDm += qHat;

      // 7. Doubly Robust: Q_hat(x, pi_e) + w_i * (Y_i - Q_hat(x, a_i))
      const dr = qHat + w * (reward - qHat);
      sumDr += dr;
    }

    // Diagnostics calculation
    const ess = sumSquaredWeights > 0 ? (sumWeights * sumWeights) / sumSquaredWeights : 0;
    const essRatio = ess / n;
    const meanWeight = sumWeights / n;
    const weightVariance = weights.reduce((acc, w) => acc + Math.pow(w - meanWeight, 2), 0) / n;

    const ipsValue = sumIps / n;
    const snipsValue = sumWeights > 0 ? sumSnipsNumerator / sumWeights : 0;
    const doublyRobustValue = sumDr / n;
    const directMethodValue = sumDm / n;
    const behaviorBaselineValue = sumBehaviorReward / n;

    const diagnostics: OPEDiagnostics = {
      effectiveSampleSize: Math.round(ess * 10) / 10,
      essRatio: Math.round(essRatio * 1000) / 1000,
      maxImportanceWeight: Math.round(maxWeight * 100) / 100,
      minImportanceWeight: Math.round(minWeight * 100) / 100,
      weightVariance: Math.round(weightVariance * 1000) / 1000,
      policyCoverage: Math.round((coveredRows / n) * 1000) / 1000,
      isEssDegraded: essRatio < 0.25 || maxWeight > 25.0,
    };

    return {
      targetPolicyVersion: targetArtifact.version,
      behaviorPolicyVersion: observations[0]?.decisionId ? "policy_logged_behavior" : "policy_v1",
      sampleSize: n,
      ipsValue: Math.round(ipsValue * 1000) / 1000,
      snipsValue: Math.round(snipsValue * 1000) / 1000,
      doublyRobustValue: Math.round(doublyRobustValue * 1000) / 1000,
      directMethodValue: Math.round(directMethodValue * 1000) / 1000,
      behaviorBaselineValue: Math.round(behaviorBaselineValue * 1000) / 1000,
      estimatedLiftIps: Math.round(((ipsValue - behaviorBaselineValue) / Math.max(0.01, behaviorBaselineValue)) * 1000) / 10,
      estimatedLiftSnips: Math.round(((snipsValue - behaviorBaselineValue) / Math.max(0.01, behaviorBaselineValue)) * 1000) / 10,
      estimatedLiftDr: Math.round(((doublyRobustValue - behaviorBaselineValue) / Math.max(0.01, behaviorBaselineValue)) * 1000) / 10,
      diagnostics,
    };
  }
}

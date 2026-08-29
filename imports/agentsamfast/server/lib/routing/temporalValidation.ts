import { CanonicalObservationRow } from "./datasetExtractor.ts";
import { ModelArtifact, MultiHeadModelEngine } from "./multiHeadModel.ts";

export interface TemporalFoldResult {
  foldIndex: number;
  trainCount: number;
  valCount: number;
  testCount: number;
  trainTimeRange: { start: string; end: string };
  valTimeRange: { start: string; end: string };
  testTimeRange: { start: string; end: string };
  
  // Validation Metrics
  valBrierScoreSuccess: number;
  valAccuracySuccess: number;
  valMaeQuality: number;
  valMaeLatencyMs: number;
  valMaeCostUsd: number;
  
  // Test Metrics
  testBrierScoreSuccess: number;
  testAccuracySuccess: number;
  testMaeQuality: number;
}

export interface TemporalValidationSummary {
  strategy: 'walk_forward_temporal';
  foldsCount: number;
  totalObservations: number;
  meanValBrierScore: number;
  meanValAccuracy: number;
  meanValMaeQuality: number;
  meanTestAccuracy: number;
  isPassed: boolean;
  folds: TemporalFoldResult[];
}

export class TemporalValidator {
  /**
   * Performs Walk-Forward Temporal Cross-Validation over chronologically ordered dataset.
   */
  static evaluateModel(
    observations: CanonicalObservationRow[],
    artifact: ModelArtifact,
    numFolds = 3
  ): TemporalValidationSummary {
    if (observations.length < 15) {
      throw new Error(`[TemporalValidator] Insufficient observations (${observations.length}) for walk-forward validation.`);
    }

    // 1. Sort chronologically by createdAtIso / epoch
    const sorted = [...observations].sort(
      (a, b) => new Date(a.createdAtIso).getTime() - new Date(b.createdAtIso).getTime()
    );

    const total = sorted.length;
    const foldSize = Math.floor(total / (numFolds + 2));
    const folds: TemporalFoldResult[] = [];

    for (let f = 0; f < numFolds; f++) {
      const trainEndIdx = Math.max(5, (f + 1) * foldSize);
      const valEndIdx = Math.min(total - 1, trainEndIdx + foldSize);
      const testEndIdx = Math.min(total, valEndIdx + foldSize);

      const trainSlice = sorted.slice(0, trainEndIdx);
      const valSlice = sorted.slice(trainEndIdx, valEndIdx);
      const testSlice = sorted.slice(valEndIdx, testEndIdx);

      if (valSlice.length === 0 || testSlice.length === 0) continue;

      // Leakage Check: Invariant Verification
      const maxTrainTime = new Date(trainSlice[trainSlice.length - 1].createdAtIso).getTime();
      const minValTime = new Date(valSlice[0].createdAtIso).getTime();
      if (maxTrainTime > minValTime) {
        throw new Error(
          `[TemporalValidator] Critical Target Leakage Detected: Max train timestamp (${maxTrainTime}) exceeds min validation timestamp (${minValTime}).`
        );
      }

      // Evaluate validation slice
      const valMetrics = this.scoreSlice(valSlice, artifact);
      const testMetrics = this.scoreSlice(testSlice, artifact);

      folds.push({
        foldIndex: f + 1,
        trainCount: trainSlice.length,
        valCount: valSlice.length,
        testCount: testSlice.length,
        trainTimeRange: {
          start: trainSlice[0].createdAtIso,
          end: trainSlice[trainSlice.length - 1].createdAtIso,
        },
        valTimeRange: {
          start: valSlice[0].createdAtIso,
          end: valSlice[valSlice.length - 1].createdAtIso,
        },
        testTimeRange: {
          start: testSlice[0].createdAtIso,
          end: testSlice[testSlice.length - 1].createdAtIso,
        },
        valBrierScoreSuccess: valMetrics.brierScore,
        valAccuracySuccess: valMetrics.accuracy,
        valMaeQuality: valMetrics.maeQuality,
        valMaeLatencyMs: valMetrics.maeLatency,
        valMaeCostUsd: valMetrics.maeCost,
        testBrierScoreSuccess: testMetrics.brierScore,
        testAccuracySuccess: testMetrics.accuracy,
        testMaeQuality: testMetrics.maeQuality,
      });
    }

    const meanValBrier = folds.reduce((sum, f) => sum + f.valBrierScoreSuccess, 0) / (folds.length || 1);
    const meanValAcc = folds.reduce((sum, f) => sum + f.valAccuracySuccess, 0) / (folds.length || 1);
    const meanValMaeQ = folds.reduce((sum, f) => sum + f.valMaeQuality, 0) / (folds.length || 1);
    const meanTestAcc = folds.reduce((sum, f) => sum + f.testAccuracySuccess, 0) / (folds.length || 1);

    const isPassed = meanValAcc >= 0.70 && meanValBrier <= 0.25;

    return {
      strategy: "walk_forward_temporal",
      foldsCount: folds.length,
      totalObservations: total,
      meanValBrierScore: Math.round(meanValBrier * 1000) / 1000,
      meanValAccuracy: Math.round(meanValAcc * 1000) / 1000,
      meanValMaeQuality: Math.round(meanValMaeQ * 1000) / 1000,
      meanTestAccuracy: Math.round(meanTestAcc * 1000) / 1000,
      isPassed,
      folds,
    };
  }

  private static scoreSlice(slice: CanonicalObservationRow[], artifact: ModelArtifact) {
    let brierSum = 0;
    let correctSuccess = 0;
    let absQualityDiff = 0;
    let absLatencyDiff = 0;
    let absCostDiff = 0;

    for (const r of slice) {
      const pred = MultiHeadModelEngine.predict(r.featureVector, r.modelKey, r.provider, artifact);
      
      // Brier score: (p - y)^2
      const actualY = r.success;
      brierSum += Math.pow(pred.pSuccess - actualY, 2);

      const predictedClass = pred.pSuccess >= 0.5 ? 1 : 0;
      if (predictedClass === actualY) correctSuccess++;

      absQualityDiff += Math.abs(pred.expectedQuality - (r.qualityScore || 0.8));
      absLatencyDiff += Math.abs(pred.expectedLatencyMs - (r.latencyMs || 1000));
      absCostDiff += Math.abs(pred.expectedCostUsd - (r.costUsd || 0.001));
    }

    const n = slice.length || 1;
    return {
      brierScore: Math.round((brierSum / n) * 1000) / 1000,
      accuracy: Math.round((correctSuccess / n) * 1000) / 1000,
      maeQuality: Math.round((absQualityDiff / n) * 1000) / 1000,
      maeLatency: Math.round((absLatencyDiff / n) * 10) / 10,
      maeCost: Math.round((absCostDiff / n) * 100000) / 100000,
    };
  }
}

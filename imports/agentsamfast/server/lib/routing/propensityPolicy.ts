import { MultiHeadPredictions, MultiHeadModelEngine, ModelArtifact } from "./multiHeadModel.ts";
import { PhiResult, ContextFeaturesInput, ActionFeaturesInput, FeatureConstructor } from "./featureSchema.ts";

export interface CandidatePolicyEvaluation {
  armId: string;
  modelKey: string;
  provider: string;
  rawAction: ActionFeaturesInput;
  phi: PhiResult;
  predictions: MultiHeadPredictions;
  utility: number;
  softmaxProbability: number;
  behaviorPropensity: number; // Exact pi_b(a|x)
}

export interface ShadowPolicyDecision {
  shadowPolicyVersion: string;
  selectedModelKey: string;
  selectedProvider: string;
  predictedUtility: number;
  predictedSuccess: number;
  predictedLatencyMs: number;
  predictedCostUsd: number;
  wouldDisagreeWithBehavior: boolean;
  shadowPropensity: number; // pi_e(a|x)
}

export interface PropensityPolicyResult {
  chosenAction: CandidatePolicyEvaluation;
  allCandidates: CandidatePolicyEvaluation[];
  loggedPropensity: number; // Exact pi_b(chosen_a | x)
  temperatureTau: number;
  explorationEpsilon: number;
  isExplorationSample: boolean;
  shadowDecisions: ShadowPolicyDecision[];
}

export class PropensityPolicyEngine {
  public static readonly DEFAULT_TEMPERATURE = 0.25;
  public static readonly DEFAULT_EXPLORATION_FLOOR = 0.05; // 5% controlled exploration

  /**
   * Samples a discrete action from a categorical distribution given exact probabilities.
   */
  private static sampleCategorical(probabilities: number[]): { index: number; isExploration: boolean } {
    const r = Math.random();
    let cumulative = 0;
    for (let i = 0; i < probabilities.length; i++) {
      cumulative += probabilities[i];
      if (r <= cumulative || i === probabilities.length - 1) {
        return { index: i, isExploration: false };
      }
    }
    return { index: 0, isExploration: false };
  }

  /**
   * Evaluates candidates, computes exact behavior policy probabilities, samples action,
   * and runs parallel shadow evaluations.
   */
  static evaluateAndSample(
    ctx: ContextFeaturesInput,
    candidateActions: ActionFeaturesInput[],
    options: {
      temperature?: number;
      explorationFloor?: number;
      mode?: string;
      activeArtifact?: ModelArtifact;
      shadowArtifacts?: ModelArtifact[];
    } = {}
  ): PropensityPolicyResult {
    const tau = options.temperature ?? this.DEFAULT_TEMPERATURE;
    const eps = options.explorationFloor ?? this.DEFAULT_EXPLORATION_FLOOR;
    const mode = options.mode || ctx.mode || "agent";
    const artifact = options.activeArtifact || MultiHeadModelEngine.predict as any;

    if (candidateActions.length === 0) {
      throw new Error("[PropensityPolicy] No candidate actions provided.");
    }

    // 1. Evaluate multi-head predictions and utility for all candidates
    const evaluations: CandidatePolicyEvaluation[] = candidateActions.map((act, idx) => {
      const phi = FeatureConstructor.buildPhi(ctx, act);
      const preds = MultiHeadModelEngine.predict(phi.phiVector, act.modelKey, act.provider);
      const utility = MultiHeadModelEngine.computeProductUtility(preds, mode);

      return {
        armId: `arm_${act.provider}_${act.modelKey.replace(/[^a-zA-Z0-9]/g, "_")}`,
        modelKey: act.modelKey,
        provider: act.provider,
        rawAction: act,
        phi,
        predictions: preds,
        utility,
        softmaxProbability: 0,
        behaviorPropensity: 0,
      };
    });

    // 2. Softmax over candidate utilities: p_softmax(a|x) = exp(U / tau) / sum(exp(U / tau))
    const maxU = Math.max(...evaluations.map((e) => e.utility));
    let sumExp = 0;
    const expValues = evaluations.map((e) => {
      const exp = Math.exp((e.utility - maxU) / Math.max(0.01, tau));
      sumExp += exp;
      return exp;
    });

    const numCandidates = evaluations.length;
    evaluations.forEach((e, idx) => {
      e.softmaxProbability = expValues[idx] / sumExp;
      
      // 3. Behavior policy with exploration floor:
      // pi_b(a|x) = (1 - eps) * p_softmax(a|x) + (eps / |A|)
      const exactProb = (1.0 - eps) * e.softmaxProbability + eps / numCandidates;
      e.behaviorPropensity = Math.round(exactProb * 10000) / 10000;
    });

    // 4. Sample action from exact behavior policy distribution
    const probabilities = evaluations.map((e) => e.behaviorPropensity);
    const { index: chosenIdx } = this.sampleCategorical(probabilities);
    const chosenAction = evaluations[chosenIdx];
    const loggedPropensity = chosenAction.behaviorPropensity;

    // Detect if choice was an exploration sample vs greedy argmax
    const bestIdx = evaluations.reduce((maxI, curr, i, arr) => (curr.utility > arr[maxI].utility ? i : maxI), 0);
    const isExplorationSample = chosenIdx !== bestIdx;

    // 5. Evaluate Shadow Policies in Parallel
    const shadowDecisions: ShadowPolicyDecision[] = [];
    const shadowArtifacts = options.shadowArtifacts || MultiHeadModelEngine.getShadowArtifacts();

    for (const shadowArt of shadowArtifacts) {
      let shadowBestEval: { act: ActionFeaturesInput; utility: number; preds: MultiHeadPredictions } | null = null;
      const shadowUtilities: number[] = [];

      for (const act of candidateActions) {
        const phi = FeatureConstructor.buildPhi(ctx, act);
        const preds = MultiHeadModelEngine.predict(phi.phiVector, act.modelKey, act.provider, shadowArt);
        const utility = MultiHeadModelEngine.computeProductUtility(preds, mode);
        shadowUtilities.push(utility);

        if (!shadowBestEval || utility > shadowBestEval.utility) {
          shadowBestEval = { act, utility, preds };
        }
      }

      if (shadowBestEval) {
        // Compute shadow policy's propensity for the behavior-chosen action
        const shadowMaxU = Math.max(...shadowUtilities);
        let shadowSumExp = 0;
        const shadowExp = shadowUtilities.map((u) => {
          const exp = Math.exp((u - shadowMaxU) / Math.max(0.01, tau));
          shadowSumExp += exp;
          return exp;
        });
        const chosenShadowSoftmax = shadowExp[chosenIdx] / shadowSumExp;
        const chosenShadowPropensity = (1.0 - eps) * chosenShadowSoftmax + eps / numCandidates;

        shadowDecisions.push({
          shadowPolicyVersion: shadowArt.version,
          selectedModelKey: shadowBestEval.act.modelKey,
          selectedProvider: shadowBestEval.act.provider,
          predictedUtility: shadowBestEval.utility,
          predictedSuccess: shadowBestEval.preds.pSuccess,
          predictedLatencyMs: shadowBestEval.preds.expectedLatencyMs,
          predictedCostUsd: shadowBestEval.preds.expectedCostUsd,
          wouldDisagreeWithBehavior: shadowBestEval.act.modelKey !== chosenAction.modelKey,
          shadowPropensity: Math.round(chosenShadowPropensity * 10000) / 10000,
        });
      }
    }

    return {
      chosenAction,
      allCandidates: evaluations,
      loggedPropensity,
      temperatureTau: tau,
      explorationEpsilon: eps,
      isExplorationSample,
      shadowDecisions,
    };
  }
}

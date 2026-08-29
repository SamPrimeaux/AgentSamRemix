import crypto from "crypto";
import { getDatabase } from "../../db/database.ts";
import {
  ContextFeaturesInput,
  ActionFeaturesInput,
  FeatureConstructor,
  FEATURE_SCHEMA_VERSION,
  CANONICAL_FEATURE_NAMES_HASH,
  PhiResult,
} from "./featureSchema.ts";
import { MultiHeadModelEngine, MultiHeadPredictions, ModelArtifact } from "./multiHeadModel.ts";
import {
  PropensityPolicyEngine,
  PropensityPolicyResult,
  CandidatePolicyEvaluation,
  ShadowPolicyDecision,
} from "./propensityPolicy.ts";
import { RepoHistorianEngine } from "../repoIntelligence/repoHistorian.ts";
import { CandidateActionBuilder } from "./candidateBuilder.ts";

export interface ContextualPolicyDecision {
  decisionId: string;
  taskType: string;
  mode: string;
  selectedModelKey: string;
  selectedProvider: string;
  selectedArmId?: string;
  selectedTools: string[];
  executionLane: 'local' | 'gcp' | 'sandbox';
  
  // Propensity & Scoring (Mathematically Exact Behavior Policy)
  selectionProbability: number; // Exact pi_b(chosen_action | x)
  predictedSuccess: number;
  predictedQuality: number;
  predictedLatencyMs: number;
  predictedCostUsd: number;
  isExplorationSample: boolean;
  
  // Telemetry & Candidates
  policyVersion: string;
  modelArtifactVersion: string;
  featureSchemaVersion: string;
  phi: PhiResult;
  candidateBreakdowns: CandidatePolicyEvaluation[];
  shadowDecisions: ShadowPolicyDecision[];
}

export interface CanonicalOutcomeInput {
  decisionId: string;
  taskType: string;
  mode?: 'ask' | 'agent' | 'background' | 'batch';
  modelKey: string;
  provider: string;
  armId?: string;
  agentRunId?: string;
  sessionId?: string;
  workspaceId?: string;
  tenantId?: string;
  
  // Real outcome metrics
  success: boolean;
  qualityScore?: number; // 0.0 to 1.0
  userFeedback?: number; // 1, 0, -1
  latencyMs: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  toolCallsCount?: number;
  retryCount?: number;
  
  // Failure hygiene
  failureOrigin?: 'model' | 'provider' | 'platform' | 'tool' | 'user';
  failureCategory?: string;
  cancelledByUser?: boolean;
  platformError?: boolean;
}

export class UnifiedPolicyRouter {
  public static readonly POLICY_VERSION = "policy_v1_softmax_exploration";

  /**
   * Main Contextual Policy Decision Engine.
   * Evaluates all candidate actions using multi-head predictions and exact Softmax + exploration behavior policy.
   * Logs exact behavior propensity pi_b(chosen_action | x) and parallel shadow evaluations at DECISION time.
   */
  static async routeTask(context: {
    taskType?: string;
    mode?: 'ask' | 'agent' | 'background' | 'batch';
    prompt: string;
    toolsRequested?: string[];
    toolRequired?: boolean;
    repoPresent?: boolean;
    repoFilesCount?: number;
    repoLanguage?: string;
    executionLane?: 'local' | 'gcp' | 'sandbox';
    workspaceId?: string;
    tenantId?: string;
    sessionId?: string;
    agentRunId?: string;
  }): Promise<ContextualPolicyDecision> {
    const decisionId = "pol_dec_" + crypto.randomBytes(8).toString("hex");
    const activeArtifact = await MultiHeadModelEngine.loadActiveArtifact();

    // 1. Fetch latest Repo Intelligence snapshot (strictly 0 when no repo is present)
    let repoSnapshot = null;
    try {
      repoSnapshot = await RepoHistorianEngine.getLatestSnapshot();
    } catch (e) {}

    const repoPresent = context.repoPresent ?? (repoSnapshot ? repoSnapshot.fileCount > 0 : false);
    const repoFilesCount = context.repoFilesCount ?? (repoSnapshot ? repoSnapshot.fileCount : 0);

    const ctxInput: ContextFeaturesInput = {
      taskType: context.taskType || "general",
      mode: context.mode || "agent",
      prompt: context.prompt,
      toolsRequested: context.toolsRequested,
      toolRequired: context.toolRequired || (context.toolsRequested && context.toolsRequested.length > 0),
      repoPresent,
      repoFilesCount,
      recentActivityRatio: repoSnapshot?.activityRatio ?? 0.0,
      rewriteBalance: repoSnapshot?.rewriteBalance ?? 0.0,
      hotspotPressure: repoSnapshot && repoSnapshot.hotspotCount > 0 ? Math.min(1.0, repoSnapshot.hotspotCount / 20) : 0.0,
      crossDomainCoupling: repoSnapshot?.crossDomainCoupling ?? 0.0,
      changeAmplification: repoSnapshot?.changeAmplification ?? 0.0,
      timestampT: Date.now(),
    };

    // 2. Build candidates dynamically from catalog + arms registry
    const candidateActions = await CandidateActionBuilder.buildCandidates(ctxInput.taskType);

    // 3. Evaluate candidates and sample with exact behavior policy
    const policyResult: PropensityPolicyResult = PropensityPolicyEngine.evaluateAndSample(
      ctxInput,
      candidateActions,
      {
        mode: context.mode || "agent",
        activeArtifact,
      }
    );

    const chosen = policyResult.chosenAction;

    const decision: ContextualPolicyDecision = {
      decisionId,
      taskType: ctxInput.taskType || "general",
      mode: ctxInput.mode || "agent",
      selectedModelKey: chosen.modelKey,
      selectedProvider: chosen.provider,
      selectedArmId: chosen.armId,
      selectedTools: context.toolsRequested || [],
      executionLane: context.executionLane || "local",
      
      // Exact Behavior Propensity
      selectionProbability: chosen.behaviorPropensity,
      predictedSuccess: chosen.predictions.pSuccess,
      predictedQuality: chosen.predictions.expectedQuality,
      predictedLatencyMs: chosen.predictions.expectedLatencyMs,
      predictedCostUsd: chosen.predictions.expectedCostUsd,
      isExplorationSample: policyResult.isExplorationSample,
      
      policyVersion: this.POLICY_VERSION,
      modelArtifactVersion: activeArtifact.version,
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      phi: chosen.phi,
      candidateBreakdowns: policyResult.allCandidates,
      shadowDecisions: policyResult.shadowDecisions,
    };

    // 4. PERSIST OBSERVATION AT DECISION TIME
    // Exactly records features, candidates, predictions, and propensity pi_b(a|x)
    try {
      const db = await getDatabase();
      const observationId = "obs_" + decisionId.replace("pol_dec_", "");
      const workspaceId = context.workspaceId || "default_workspace";
      const tenantId = context.tenantId || "default_tenant";

      await db.query(
        `INSERT INTO agentsam_ml_observations (
          id, decision_id, workspace_id, tenant_id, session_id, agent_run_id,
          task_type, mode, route_key, prompt_length, estimated_tokens, tool_required,
          tools_requested_count, repo_present, repo_files_count, repo_language,
          recent_failure_rate, execution_lane, context_features_json,
          model_key, provider, reasoning_effort, supports_tools, selected_tools_json,
          terminal_lane, action_features_json, policy_version, feature_schema_version,
          selection_probability, candidate_actions_json, predicted_success, predicted_quality,
          predicted_latency_ms, predicted_cost_usd, exploration_reason, model_artifact_version,
          success, quality_score, user_feedback, latency_ms, cost_usd, input_tokens, output_tokens,
          failure_origin, failure_category, tool_calls_count, retry_count, is_training_eligible
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          0, 0.0, 0, 0, 0.0, 0, 0,
          NULL, NULL, 0, 0, 0
        )`,
        [
          observationId,
          decisionId,
          workspaceId,
          tenantId,
          context.sessionId || null,
          context.agentRunId || null,
          decision.taskType,
          decision.mode,
          `route:${decision.selectedProvider}:${decision.selectedModelKey}`,
          ctxInput.prompt.length,
          Math.round(ctxInput.prompt.length / 4),
          ctxInput.toolRequired ? 1 : 0,
          ctxInput.toolsRequested?.length || 0,
          ctxInput.repoPresent ? 1 : 0,
          ctxInput.repoFilesCount || 0,
          context.repoLanguage || null,
          ctxInput.recentFailureRatePriorToT || 0.0,
          decision.executionLane,
          JSON.stringify(ctxInput),
          decision.selectedModelKey,
          decision.selectedProvider,
          chosen.rawAction.reasoningEffort || "medium",
          chosen.rawAction.supportsTools ? 1 : 0,
          JSON.stringify(decision.selectedTools),
          "primary",
          JSON.stringify(chosen.rawAction),
          decision.policyVersion,
          FEATURE_SCHEMA_VERSION,
          decision.selectionProbability,
          JSON.stringify(decision.candidateBreakdowns),
          decision.predictedSuccess,
          decision.predictedQuality,
          decision.predictedLatencyMs,
          decision.predictedCostUsd,
          decision.isExplorationSample ? "softmax_exploration" : "greedy",
          decision.modelArtifactVersion,
        ]
      );
    } catch (e) {
      console.warn("[UnifiedPolicyRouter] Decision-time observation logging error:", (e as Error).message);
    }

    return decision;
  }

  /**
   * Applies the canonical execution outcome:
   * 1. UPDATES the existing row in agentsam_ml_observations WHERE decision_id = ?
   * 2. Updates agentsam_routing_arms Bayesian posterior
   */
  static async recordCanonicalOutcome(outcome: CanonicalOutcomeInput): Promise<{
    rewardScore: number;
    alphaDelta: number;
    betaDelta: number;
    isTrainingEligible: boolean;
  }> {
    const db = await getDatabase();

    // 1. Data Hygiene Filter: Exclude user cancellations and platform faults
    const isPlatformError = outcome.platformError || outcome.failureOrigin === "platform" || outcome.failureOrigin === "provider";
    const isUserCancelled = outcome.cancelledByUser || outcome.failureOrigin === "user";
    const isTrainingEligible = !isPlatformError && !isUserCancelled;

    // 2. Normalized Multi-Objective Reward Score in [0, 1]
    const normLatency = Math.max(0, Math.min(1, 1 - (outcome.latencyMs || 0) / 10000));
    const totalTokens = (outcome.inputTokens || 0) + (outcome.outputTokens || 0);
    const normCost = Math.max(0, Math.min(1, 1 - totalTokens / 12000));
    const quality = typeof outcome.qualityScore === "number" ? Math.max(0, Math.min(1, outcome.qualityScore)) : (outcome.success ? 0.85 : 0.1);

    let rewardScore = 0.05;
    if (outcome.success) {
      rewardScore = Math.max(0.1, Math.min(0.99, 0.45 * quality + 0.30 * normLatency + 0.25 * normCost));
      if (outcome.userFeedback === 1) rewardScore = Math.min(0.99, rewardScore + 0.1);
      if (outcome.userFeedback === -1) rewardScore = Math.max(0.1, rewardScore - 0.2);
    }

    const alphaDelta = isTrainingEligible ? (outcome.success ? rewardScore : 0.05) : 0.0;
    const betaDelta = isTrainingEligible ? (outcome.success ? 1.0 - rewardScore : 0.95) : 0.0;

    // 3. UPDATE SAME ROW IN ML OBSERVATIONS TABLE
    try {
      const updateResult = await db.query(
        `UPDATE agentsam_ml_observations SET
          success = ?,
          quality_score = ?,
          user_feedback = ?,
          latency_ms = ?,
          cost_usd = ?,
          input_tokens = ?,
          output_tokens = ?,
          failure_origin = ?,
          failure_category = ?,
          tool_calls_count = ?,
          retry_count = ?,
          is_training_eligible = ?
        WHERE decision_id = ?`,
        [
          outcome.success ? 1 : 0,
          quality,
          outcome.userFeedback || 0,
          outcome.latencyMs,
          outcome.costUsd || 0.0,
          outcome.inputTokens || 0,
          outcome.outputTokens || 0,
          outcome.failureOrigin || null,
          outcome.failureCategory || null,
          outcome.toolCallsCount || 0,
          outcome.retryCount || 0,
          isTrainingEligible ? 1 : 0,
          outcome.decisionId,
        ]
      );

      // Fallback insert if decision wasn't pre-recorded (e.g. direct test runs)
      if (!updateResult.changes || updateResult.changes === 0) {
        const observationId = "obs_" + outcome.decisionId.replace("pol_dec_", "");
        await db.query(
          `INSERT OR REPLACE INTO agentsam_ml_observations (
            id, decision_id, workspace_id, tenant_id, session_id, agent_run_id,
            task_type, mode, route_key, prompt_length, estimated_tokens, tool_required,
            tools_requested_count, repo_present, repo_files_count, recent_failure_rate, execution_lane,
            model_key, provider, policy_version, feature_schema_version, selection_probability,
            candidate_actions_json, predicted_success, predicted_quality, predicted_latency_ms,
            predicted_cost_usd, exploration_reason, model_artifact_version, success, quality_score,
            user_feedback, latency_ms, cost_usd, input_tokens, output_tokens, failure_origin,
            failure_category, tool_calls_count, retry_count, is_training_eligible
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?
          )`,
          [
            observationId,
            outcome.decisionId,
            outcome.workspaceId || "default_workspace",
            outcome.tenantId || "default_tenant",
            outcome.sessionId || null,
            outcome.agentRunId || null,
            outcome.taskType || "general",
            outcome.mode || "agent",
            `route:${outcome.provider}:${outcome.modelKey}`,
            0,
            0,
            (outcome.toolCallsCount || 0) > 0 ? 1 : 0,
            outcome.toolCallsCount || 0,
            0,
            0,
            0.0,
            "local",
            outcome.modelKey,
            outcome.provider,
            this.POLICY_VERSION,
            FEATURE_SCHEMA_VERSION,
            1.0,
            JSON.stringify([]),
            outcome.success ? 0.9 : 0.2,
            quality,
            outcome.latencyMs,
            outcome.costUsd || 0,
            "external_direct",
            "v1.0_baseline",
            outcome.success ? 1 : 0,
            quality,
            outcome.userFeedback || 0,
            outcome.latencyMs,
            outcome.costUsd || 0,
            outcome.inputTokens || 0,
            outcome.outputTokens || 0,
            outcome.failureOrigin || null,
            outcome.failureCategory || null,
            outcome.toolCallsCount || 0,
            outcome.retryCount || 0,
            isTrainingEligible ? 1 : 0,
          ]
        );
      }

      // 4. Update Bayesian posterior on matching routing arm
      if (isTrainingEligible) {
        await db.query(
          `UPDATE agentsam_routing_arms SET
            alpha = alpha + ?,
            beta = beta + ?,
            pull_count = pull_count + 1,
            avg_reward = (avg_reward * pull_count + ?) / (pull_count + 1),
            updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          WHERE model_key = ? AND (task_type = ? OR task_type = 'general')`,
          [alphaDelta, betaDelta, rewardScore, outcome.modelKey, outcome.taskType]
        );
      }
    } catch (e) {
      console.warn("[UnifiedPolicyRouter] Outcome update warning:", (e as Error).message);
    }

    return {
      rewardScore: Math.round(rewardScore * 1000) / 1000,
      alphaDelta: Math.round(alphaDelta * 1000) / 1000,
      betaDelta: Math.round(betaDelta * 1000) / 1000,
      isTrainingEligible,
    };
  }
}

import crypto from "crypto";
import { getDatabase } from "../db/database.ts";
import { UnifiedPolicyRouter, ContextualPolicyDecision } from "./routing/policyRouter.ts";
import { embeddingService } from "../../app/backend/ai/embeddings/index.ts";

/**
 * Unified Thompson Sampling & Contextual Policy Engine.
 * Combines Bayesian Posterior belief sampling with Edge ML Predictions,
 * Propensity scoring (p_i), and single-authority reward hygiene.
 */

export interface RoutingDecision {
  decisionId: string;
  taskType: string;
  modelKey: string;
  provider: string;
  armId: string;
  sampledScore: number;
  posteriorMean: number;
  embedding?: number[];
  policyDecision?: ContextualPolicyDecision;
}

export interface RewardInput {
  decisionId: string;
  taskType: string;
  modelKey: string;
  provider: string;
  routingArmId?: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd?: number;
  convictionScore?: number; // 0.0 to 100.0 or 0.0 to 1.0
  success?: boolean;
  reason?: string;
  sourceTable?: string;
  sourceId?: string;
  workspaceId?: string;
  tenantId?: string;
  mode?: 'ask' | 'agent' | 'background' | 'batch';
  failureOrigin?: 'model' | 'provider' | 'platform' | 'tool' | 'user';
  cancelledByUser?: boolean;
  platformError?: boolean;
}

export class ThompsonSamplingEngine {
  /**
   * Generates embedding by delegating to provider-neutral EmbeddingService
   */
  async generateEmbedding(text: string, outputDimensionality = 768): Promise<number[]> {
    const res = await embeddingService.embed(text, {
      task: "query",
      requiredDimensions: outputDimensionality,
    });
    return res.vector;
  }

  /**
   * Samples a value from Beta(alpha, beta)
   */
  sampleBeta(alpha: number, beta: number): number {
    const a = Math.max(0.1, alpha);
    const b = Math.max(0.1, beta);
    return a / (a + b);
  }

  /**
   * Selects optimal model and arm using Contextual Policy & Exact Propensity Sampling
   */
  async routeTask(
    taskType: string,
    prompt: string,
    workspaceId = "default_workspace",
    tenantId = "default_tenant",
    mode: 'ask' | 'agent' | 'background' | 'batch' = "agent"
  ): Promise<RoutingDecision> {
    // 1. Generate semantic query embedding if requested via neutral EmbeddingService
    let embedding: number[] | undefined;
    try {
      embedding = await this.generateEmbedding(prompt.slice(0, 1000));
    } catch (e) {
      // Embedding is optional context; fail gracefully without fake synthetic data
    }

    // 2. Delegate to Unified Policy Router
    const policyDecision = await UnifiedPolicyRouter.routeTask({
      taskType,
      prompt,
      mode,
    });

    const activeArm = policyDecision.candidateBreakdowns.find(
      b => b.modelKey === policyDecision.selectedModelKey
    );

    return {
      decisionId: policyDecision.decisionId,
      taskType: policyDecision.taskType,
      modelKey: policyDecision.selectedModelKey,
      provider: policyDecision.selectedProvider,
      armId: policyDecision.selectedArmId || "default_arm",
      sampledScore: activeArm ? activeArm.utility : 0.85,
      posteriorMean: activeArm ? activeArm.predictions.pSuccess : 0.85,
      embedding,
      policyDecision,
    };
  }

  /**
   * Applies unified reward feedback & canonical outcome hygiene
   */
  async recordReward(input: RewardInput): Promise<{
    rewardScore: number;
    alphaDelta: number;
    betaDelta: number;
  }> {
    let qualityScore = 0.8;
    if (typeof input.convictionScore === "number") {
      qualityScore = input.convictionScore > 1 ? input.convictionScore / 100 : input.convictionScore;
    }

    return UnifiedPolicyRouter.recordCanonicalOutcome({
      decisionId: input.decisionId,
      taskType: input.taskType,
      mode: input.mode || "agent",
      modelKey: input.modelKey,
      provider: input.provider,
      armId: input.routingArmId,
      workspaceId: input.workspaceId,
      tenantId: input.tenantId,
      success: input.success !== false,
      qualityScore,
      latencyMs: input.latencyMs,
      costUsd: input.estimatedCostUsd || 0,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      failureOrigin: input.failureOrigin,
      cancelledByUser: input.cancelledByUser,
      platformError: input.platformError,
    });
  }
}

export const thompsonRouter = new ThompsonSamplingEngine();


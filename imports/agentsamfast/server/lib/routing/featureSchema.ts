import crypto from "crypto";

/**
 * AgentSam Canonical Feature Schema & Invariant Enforcement Engine.
 * Explicitly separates Context Features X from Action Features A and constructs
 * interaction representations phi(X, A) at prediction time.
 * Enforces strict fail-closed schema invariants.
 */

export const FEATURE_SCHEMA_VERSION = "v1.0";
export const CANONICAL_CONTEXT_DIM = 16;
export const CANONICAL_ACTION_DIM = 8;
export const CANONICAL_TOTAL_DIM = CANONICAL_CONTEXT_DIM + CANONICAL_ACTION_DIM; // 24

export interface ContextFeaturesInput {
  taskType?: string; // 'code', 'research', 'dossier', 'chat', 'financial_synthesis', 'general'
  mode?: 'ask' | 'agent' | 'background' | 'batch';
  prompt: string;
  toolRequired?: boolean;
  toolsRequested?: string[];
  
  // Repo state
  repoPresent?: boolean;
  repoFilesCount?: number;
  repoLanguage?: string;
  repoDirty?: boolean;
  
  // Repo Intelligence Churn & Coupling Signals
  recentActivityRatio?: number; // recent_churn / baseline_churn
  rewriteBalance?: number;      // 2 * min(add, del) / total
  hotspotPressure?: number;     // 0.0 to 1.0
  crossDomainCoupling?: number; // 0.0 to 1.0
  changeAmplification?: number; // median files per commit normalized

  // Strict temporal cutoff: signals strictly prior to decision timestamp T
  recentFailureRatePriorToT?: number; 
  historicalSuccessPriorToT?: number;
  
  timestampT?: number;
}

export interface ActionFeaturesInput {
  armId?: string;
  modelKey: string;
  provider: string;
  modelFamily?: 'gemini' | 'claude' | 'gpt' | 'workers_ai' | 'local' | 'other';
  
  // Capability Tiers
  costTier?: number; // 0.1 (flash/workers), 0.5 (perseus/haiku), 0.9 (pro/sonnet)
  supportsTools?: boolean;
  reasoningEffort?: 'low' | 'medium' | 'high';
  contextWindowTier?: number; // 0.2 (128k), 0.5 (500k), 1.0 (2M)
  structuredOutputCapability?: boolean;
  
  // Historical Model-Task Performance strictly prior to T
  historicalModelSuccessPriorToT?: number; // 0.0 to 1.0
  historicalLatencyMsPriorToT?: number;
  
  // Health & Rate Limit Pressure
  providerHealth?: 'healthy' | 'degraded' | 'rate_limited';
}

export const CANONICAL_CONTEXT_FEATURE_NAMES = [
  // 0..5 Task Type One-Hot
  "ctx_task_code",
  "ctx_task_research",
  "ctx_task_dossier",
  "ctx_task_chat",
  "ctx_task_financial_synthesis",
  "ctx_task_general",

  // 6..9 Mode One-Hot
  "ctx_mode_ask",
  "ctx_mode_agent",
  "ctx_mode_background",
  "ctx_mode_batch",

  // 10..12 Prompt & Tool Complexity
  "ctx_norm_prompt_chars",      // log1p(chars) / 10
  "ctx_norm_estimated_tokens",  // log1p(tokens) / 10
  "ctx_tool_required_flag",     // 0.0 or 1.0

  // 13..15 Repo & Domain Complexity
  "ctx_repo_present_flag",      // 0.0 or 1.0
  "ctx_repo_coupling_tax",      // normalized cross-domain coupling
  "ctx_task_complexity_score",  // 0.0 to 1.0
];

export const CANONICAL_ACTION_FEATURE_NAMES = [
  // 0..2 Cost & Capacity
  "act_model_cost_tier",        // 0.1 to 0.9
  "act_supports_tools",         // 0.0 or 1.0
  "act_reasoning_effort",       // 0.3 (low), 0.6 (med), 1.0 (high)

  // 3..5 Architectural Capabilities
  "act_context_window_tier",    // 0.2 to 1.0
  "act_structured_output",      // 0.0 or 1.0
  "act_is_edge_or_local",       // 1.0 if local or workers_ai, 0.0 if frontier API

  // 6..7 Historical Prior & Health
  "act_prior_success_rate",     // strictly prior to T (0.0 to 1.0)
  "act_provider_healthy_flag",  // 1.0 if healthy, 0.0 if degraded/rate_limited
];

export const CANONICAL_FEATURE_NAMES = [
  ...CANONICAL_CONTEXT_FEATURE_NAMES,
  ...CANONICAL_ACTION_FEATURE_NAMES,
];

export function computeFeatureNamesHash(names: string[] = CANONICAL_FEATURE_NAMES): string {
  return crypto.createHash("sha256").update(names.join("::")).digest("hex").slice(0, 16);
}

export const CANONICAL_FEATURE_NAMES_HASH = computeFeatureNamesHash(CANONICAL_FEATURE_NAMES);

export interface PhiResult {
  schemaVersion: string;
  featureNamesHash: string;
  totalDimensions: number;
  contextDimensions: number;
  actionDimensions: number;
  contextVector: number[];
  actionVector: number[];
  phiVector: number[]; // Combined [X, A]
  featureNames: string[];
  denseMap: Record<string, number>;
  contextSummary: {
    taskType: string;
    mode: string;
    estimatedTokens: number;
    complexityScore: number;
    repoCouplingTax: number;
  };
}

export class FeatureSchemaValidator {
  /**
   * Enforces strict schema invariant. Fails closed if dimension, version, or hash mismatch occurs.
   */
  static validateInvariants(
    vector: number[],
    expectedVersion = FEATURE_SCHEMA_VERSION,
    expectedDim = CANONICAL_TOTAL_DIM,
    providedHash?: string
  ): void {
    if (!vector || !Array.isArray(vector)) {
      throw new Error(`[FeatureSchema] Invariant Failure: Vector is null or not an array.`);
    }
    if (vector.length !== expectedDim) {
      throw new Error(
        `[FeatureSchema] Invariant Failure: Dimension mismatch. Runtime emitted ${vector.length} dims, but schema '${expectedVersion}' requires strictly ${expectedDim} dims. (Fail-Closed: No padding or truncation allowed).`
      );
    }
    if (providedHash && providedHash !== CANONICAL_FEATURE_NAMES_HASH) {
      throw new Error(
        `[FeatureSchema] Invariant Failure: Feature names hash mismatch. Expected ${CANONICAL_FEATURE_NAMES_HASH}, got ${providedHash}.`
      );
    }
    for (let i = 0; i < vector.length; i++) {
      if (typeof vector[i] !== "number" || isNaN(vector[i]) || !isFinite(vector[i])) {
        throw new Error(`[FeatureSchema] Invariant Failure: Vector element at index ${i} is non-finite or NaN.`);
      }
    }
  }
}

export class FeatureConstructor {
  /**
   * Estimates token count (approx 4 chars per token).
   */
  static estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.max(1, Math.ceil(text.length / 4));
  }

  /**
   * Computes task complexity score [0.05, 1.0].
   */
  static computeComplexity(
    prompt: string,
    repoFiles: number = 0,
    toolsCount: number = 0,
    rewriteBalance: number = 0
  ): number {
    let score = 0.2;
    const lower = prompt.toLowerCase();

    // Length
    const len = prompt.length;
    if (len > 3000) score += 0.3;
    else if (len > 800) score += 0.2;
    else if (len > 200) score += 0.1;

    // Complex intent keywords
    const keywords = [
      "migrate", "refactor", "architect", "synthesize", "comprehensive",
      "forensic", "investigate", "multi-step", "security", "dossier", "10-k", "10-q",
      "walk-forward", "propensity", "off-policy"
    ];
    let matches = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) matches++;
    }
    score += Math.min(0.3, matches * 0.08);

    // Repo scope & rewrite churn
    if (repoFiles > 100) score += 0.15;
    else if (repoFiles > 20) score += 0.08;

    if (rewriteBalance > 0.6) score += 0.1; // High rework pressure in repo

    if (toolsCount > 3) score += 0.1;

    return Math.min(1.0, Math.max(0.05, Math.round(score * 100) / 100));
  }

  /**
   * Constructs pure Context Vector X (16 dimensions).
   */
  static buildContextVector(ctx: ContextFeaturesInput): number[] {
    const task = (ctx.taskType || "general").toLowerCase();
    const mode = ctx.mode || "agent";
    const prompt = ctx.prompt || "";
    const promptLength = prompt.length;
    const tokens = this.estimateTokens(prompt);
    const toolsCount = ctx.toolsRequested ? ctx.toolsRequested.length : (ctx.toolRequired ? 1 : 0);
    const repoFiles = ctx.repoFilesCount || 0;
    const rewriteBalance = ctx.rewriteBalance || 0;
    const complexity = this.computeComplexity(prompt, repoFiles, toolsCount, rewriteBalance);

    const x: number[] = new Array(CANONICAL_CONTEXT_DIM).fill(0);

    // 0..5: Task One-Hot
    if (task.includes("code") || task.includes("dev")) x[0] = 1.0;
    else if (task.includes("research") || task.includes("investigat")) x[1] = 1.0;
    else if (task.includes("dossier") || task.includes("sec") || task.includes("filing")) x[2] = 1.0;
    else if (task.includes("chat") || task.includes("convers")) x[3] = 1.0;
    else if (task.includes("financial") || task.includes("synth")) x[4] = 1.0;
    else x[5] = 1.0;

    // 6..9: Mode One-Hot
    if (mode === "ask") x[6] = 1.0;
    else if (mode === "agent") x[7] = 1.0;
    else if (mode === "background") x[8] = 1.0;
    else if (mode === "batch") x[9] = 1.0;

    // 10..12: Prompt & Tools
    x[10] = Math.min(1.0, Math.log1p(promptLength) / 10.0);
    x[11] = Math.min(1.0, Math.log1p(tokens) / 10.0);
    x[12] = ctx.toolRequired || toolsCount > 0 ? 1.0 : 0.0;

    // 13..15: Repo & Domain
    x[13] = ctx.repoPresent || repoFiles > 0 ? 1.0 : 0.0;
    x[14] = Math.min(1.0, Math.max(0.0, ctx.crossDomainCoupling || 0.0));
    x[15] = complexity;

    return x;
  }

  /**
   * Constructs pure Action Vector A (8 dimensions).
   */
  static buildActionVector(act?: ActionFeaturesInput): number[] {
    const a: number[] = new Array(CANONICAL_ACTION_DIM).fill(0);
    if (!act) {
      // Default baseline action features
      a[0] = 0.4;  // cost tier
      a[1] = 1.0;  // supports tools
      a[2] = 0.6;  // reasoning effort
      a[3] = 0.5;  // context window
      a[4] = 1.0;  // structured output
      a[5] = 0.0;  // cloud API
      a[6] = 0.85; // prior success
      a[7] = 1.0;  // healthy
      return a;
    }

    const modelLower = act.modelKey.toLowerCase();
    const providerLower = act.provider.toLowerCase();

    // 0: Cost tier
    let costTier = act.costTier;
    if (costTier === undefined) {
      if (modelLower.includes("pro") || modelLower.includes("sonnet") || modelLower.includes("opus") || modelLower.includes("gpt-4o")) {
        costTier = 0.9;
      } else if (modelLower.includes("perseus") || modelLower.includes("antigravity") || modelLower.includes("claude-3-5-haiku")) {
        costTier = 0.5;
      } else if (modelLower.includes("flash") || modelLower.includes("mini") || modelLower.includes("instant") || modelLower.includes("bge")) {
        costTier = 0.15;
      } else {
        costTier = 0.3;
      }
    }
    a[0] = Math.max(0.0, Math.min(1.0, costTier));

    // 1: Supports tools
    a[1] = act.supportsTools !== false ? 1.0 : 0.0;

    // 2: Reasoning effort
    let effort = 0.6;
    if (act.reasoningEffort === "low") effort = 0.3;
    else if (act.reasoningEffort === "high") effort = 1.0;
    a[2] = effort;

    // 3: Context window tier
    let cw = act.contextWindowTier;
    if (cw === undefined) {
      if (modelLower.includes("gemini")) cw = 1.0; // 2M tokens
      else if (modelLower.includes("claude") || modelLower.includes("gpt-4o")) cw = 0.6; // 200k/128k
      else cw = 0.3; // 32k
    }
    a[3] = Math.max(0.1, Math.min(1.0, cw));

    // 4: Structured output capability
    a[4] = act.structuredOutputCapability !== false ? 1.0 : 0.0;

    // 5: Edge or local model
    a[5] = providerLower === "local" || providerLower === "workers_ai" || providerLower === "ollama" ? 1.0 : 0.0;

    // 6: Historical model success strictly prior to T
    a[6] = Math.max(0.0, Math.min(1.0, act.historicalModelSuccessPriorToT !== undefined ? act.historicalModelSuccessPriorToT : 0.88));

    // 7: Provider health
    a[7] = act.providerHealth === "degraded" || act.providerHealth === "rate_limited" ? 0.0 : 1.0;

    return a;
  }

  /**
   * Constructs phi(X, A) at prediction time with strict schema validation.
   */
  static buildPhi(ctx: ContextFeaturesInput, act?: ActionFeaturesInput): PhiResult {
    const contextVector = this.buildContextVector(ctx);
    const actionVector = this.buildActionVector(act);
    const phiVector = [...contextVector, ...actionVector];

    // Invariant validation
    FeatureSchemaValidator.validateInvariants(phiVector);

    const denseMap: Record<string, number> = {};
    CANONICAL_FEATURE_NAMES.forEach((name, idx) => {
      denseMap[name] = Math.round(phiVector[idx] * 1000) / 1000;
    });

    const tokens = this.estimateTokens(ctx.prompt || "");
    const complexity = contextVector[15];

    return {
      schemaVersion: FEATURE_SCHEMA_VERSION,
      featureNamesHash: CANONICAL_FEATURE_NAMES_HASH,
      totalDimensions: CANONICAL_TOTAL_DIM,
      contextDimensions: CANONICAL_CONTEXT_DIM,
      actionDimensions: CANONICAL_ACTION_DIM,
      contextVector,
      actionVector,
      phiVector,
      featureNames: CANONICAL_FEATURE_NAMES,
      denseMap,
      contextSummary: {
        taskType: ctx.taskType || "general",
        mode: ctx.mode || "agent",
        estimatedTokens: tokens,
        complexityScore: complexity,
        repoCouplingTax: contextVector[14],
      },
    };
  }
}

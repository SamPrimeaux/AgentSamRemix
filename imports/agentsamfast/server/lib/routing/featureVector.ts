/**
 * Canonical Feature Extraction for AgentSam Policy Model & Contextual Router.
 * Maps high-level task, prompt, repo context, and model action into normalized
 * numerical feature vectors suitable for Edge inference and offline scikit-learn training.
 */

import {
  FEATURE_SCHEMA_VERSION,
  CANONICAL_FEATURE_NAMES,
} from "./featureSchema.ts";

export { FEATURE_SCHEMA_VERSION, CANONICAL_FEATURE_NAMES };

export interface TaskContextInput {
  taskType?: string; // 'code', 'research', 'dossier', 'chat', 'financial_synthesis', 'general'
  mode?: 'ask' | 'agent' | 'background' | 'batch';
  prompt: string;
  routeKey?: string;
  toolRequired?: boolean;
  toolsRequested?: string[];
  repoPresent?: boolean;
  repoFilesCount?: number;
  repoLanguage?: string;
  repoDirty?: boolean;
  recentFailureRate?: number; // 0.0 to 1.0
  historicalTaskSuccessRate?: number; // 0.0 to 1.0
  executionLane?: 'local' | 'gcp' | 'sandbox';
  workspaceId?: string;
  tenantId?: string;
}

export interface CandidateActionInput {
  modelKey: string;
  provider: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  supportsTools?: boolean;
  terminalLane?: string;
  costPerInputToken?: number;
  costPerOutputToken?: number;
}

export interface FeatureVectorResult {
  schemaVersion: string;
  featureNames: string[];
  vector: number[];
  denseDict: Record<string, number>;
  contextSummary: {
    taskType: string;
    mode: string;
    estimatedTokens: number;
    complexityScore: number;
  };
}

export const LEGACY_FEATURE_NAMES = [
  // 0..5: Task Type One-Hot
  "is_task_code",
  "is_task_research",
  "is_task_dossier",
  "is_task_chat",
  "is_task_financial_synthesis",
  "is_task_general",

  // 6..9: Execution Mode One-Hot
  "is_mode_ask",
  "is_mode_agent",
  "is_mode_background",
  "is_mode_batch",

  // 10..13: Prompt & Context Dimensions (Normalized)
  "norm_prompt_chars",       // log1p(chars) / 10
  "norm_estimated_tokens",   // log1p(tokens) / 10
  "norm_tool_count",         // count / 10
  "tool_required_flag",      // 0.0 or 1.0

  // 14..17: Repo Intelligence Features
  "repo_present_flag",       // 0.0 or 1.0
  "norm_repo_files",         // log1p(files) / 10
  "is_repo_typescript",      // 0.0 or 1.0
  "is_repo_dirty",           // 0.0 or 1.0

  // 18..20: Prior Performance & Reliability
  "recent_failure_rate",     // 0.0 to 1.0
  "historical_task_success", // 0.0 to 1.0
  "task_complexity_score",   // 0.0 to 1.0 derived from prompt syntax, length, keywords

  // 21..23: Model Action Parameters (Normalized)
  "model_cost_tier",         // 0.1 (flash), 0.5 (perseus), 0.9 (pro/sonnet)
  "model_supports_tools",    // 0.0 or 1.0
  "model_reasoning_effort",  // 0.3 (low), 0.6 (medium), 1.0 (high)
];

export class FeatureExtractor {
  /**
   * Estimates token count from raw text using tokenization heuristics (1 token ≈ 4 chars).
   */
  static estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.max(1, Math.ceil(text.length / 4));
  }

  /**
   * Computes a task complexity score from prompt structure and keywords.
   */
  static computeComplexity(prompt: string, repoFiles: number = 0, toolsCount: number = 0): number {
    let score = 0.2;
    const lower = prompt.toLowerCase();
    
    // Length contribution
    const len = prompt.length;
    if (len > 3000) score += 0.3;
    else if (len > 800) score += 0.2;
    else if (len > 200) score += 0.1;

    // Multi-step / complex keywords
    const complexKeywords = [
      "migrate", "refactor", "architect", "synthesize", "comprehensive",
      "forensic", "investigate", "multi-step", "security", "dossier", "10-k", "10-q"
    ];
    let matches = 0;
    for (const kw of complexKeywords) {
      if (lower.includes(kw)) matches++;
    }
    score += Math.min(0.3, matches * 0.08);

    // Repo scope contribution
    if (repoFiles > 100) score += 0.15;
    else if (repoFiles > 20) score += 0.08;

    // Tool dependencies
    if (toolsCount > 3) score += 0.1;

    return Math.min(1.0, Math.max(0.05, score));
  }

  /**
   * Extracts a standardized 24-dimensional feature vector.
   */
  static extractFeatures(context: TaskContextInput, action?: CandidateActionInput): FeatureVectorResult {
    const task = (context.taskType || "general").toLowerCase();
    const mode = context.mode || "agent";
    const prompt = context.prompt || "";
    const promptLength = prompt.length;
    const tokens = FeatureExtractor.estimateTokens(prompt);
    const toolsCount = context.toolsRequested ? context.toolsRequested.length : (context.toolRequired ? 1 : 0);
    const repoFiles = context.repoFilesCount || 0;
    const complexity = FeatureExtractor.computeComplexity(prompt, repoFiles, toolsCount);

    const vector: number[] = new Array(CANONICAL_FEATURE_NAMES.length).fill(0);

    // Task One-Hot (0..5)
    if (task.includes("code") || task.includes("dev")) vector[0] = 1.0;
    else if (task.includes("research") || task.includes("investigat")) vector[1] = 1.0;
    else if (task.includes("dossier") || task.includes("sec") || task.includes("filing")) vector[2] = 1.0;
    else if (task.includes("chat") || task.includes("convers")) vector[3] = 1.0;
    else if (task.includes("financial") || task.includes("synth")) vector[4] = 1.0;
    else vector[5] = 1.0;

    // Mode One-Hot (6..9)
    if (mode === "ask") vector[6] = 1.0;
    else if (mode === "agent") vector[7] = 1.0;
    else if (mode === "background") vector[8] = 1.0;
    else if (mode === "batch") vector[9] = 1.0;

    // Prompt & Dimensions (10..13)
    vector[10] = Math.min(1.0, Math.log1p(promptLength) / 10.0);
    vector[11] = Math.min(1.0, Math.log1p(tokens) / 10.0);
    vector[12] = Math.min(1.0, toolsCount / 10.0);
    vector[13] = context.toolRequired || toolsCount > 0 ? 1.0 : 0.0;

    // Repo Intelligence (14..17)
    vector[14] = context.repoPresent || repoFiles > 0 ? 1.0 : 0.0;
    vector[15] = Math.min(1.0, Math.log1p(repoFiles) / 10.0);
    vector[16] = context.repoLanguage?.toLowerCase().includes("typescript") || context.repoLanguage?.toLowerCase().includes("javascript") ? 1.0 : 0.0;
    vector[17] = context.repoDirty ? 1.0 : 0.0;

    // Reliability & Priors (18..20)
    vector[18] = Math.max(0.0, Math.min(1.0, context.recentFailureRate || 0.0));
    vector[19] = Math.max(0.0, Math.min(1.0, context.historicalTaskSuccessRate !== undefined ? context.historicalTaskSuccessRate : 0.85));
    vector[20] = complexity;

    // Action Parameters (21..23)
    if (action) {
      const modelLower = action.modelKey.toLowerCase();
      let costTier = 0.2;
      if (modelLower.includes("pro") || modelLower.includes("sonnet") || modelLower.includes("opus") || modelLower.includes("gpt-4o")) {
        costTier = 0.9;
      } else if (modelLower.includes("perseus") || modelLower.includes("antigravity") || modelLower.includes("claude-3-5-haiku")) {
        costTier = 0.5;
      } else if (modelLower.includes("flash") || modelLower.includes("mini") || modelLower.includes("instant")) {
        costTier = 0.15;
      }
      vector[21] = costTier;
      vector[22] = action.supportsTools !== false ? 1.0 : 0.0;

      let effort = 0.6;
      if (action.reasoningEffort === "low") effort = 0.3;
      else if (action.reasoningEffort === "high") effort = 1.0;
      vector[23] = effort;
    } else {
      vector[21] = 0.4;
      vector[22] = 1.0;
      vector[23] = 0.6;
    }

    const denseDict: Record<string, number> = {};
    CANONICAL_FEATURE_NAMES.forEach((name, idx) => {
      denseDict[name] = Math.round(vector[idx] * 1000) / 1000;
    });

    return {
      schemaVersion: FEATURE_SCHEMA_VERSION,
      featureNames: CANONICAL_FEATURE_NAMES,
      vector,
      denseDict,
      contextSummary: {
        taskType: task,
        mode,
        estimatedTokens: tokens,
        complexityScore: Math.round(complexity * 100) / 100,
      },
    };
  }
}

import crypto from "crypto";
import { getDatabase } from "../../db/database.ts";
import { CandidateActionBuilder } from "./candidateBuilder.ts";

/**
 * ResolvedModel: The complete, executable model identity returned by resolveModelForTask.
 * Built directly from agentsam_model_catalog, the canonical single source of truth (SSOT).
 */
export interface ResolvedModel {
  model_key: string;
  model_catalog_id: string;
  provider: string;
  api_platform: string;
  provider_model_id: string;
  routing_lane: string;
  display_name: string;

  // Capabilities
  supports_tools: boolean;
  supports_vision: boolean;
  supports_json_mode: boolean;
  supports_streaming: boolean;
  supports_reasoning: boolean;
  supports_code_execution: boolean;
  reasoning_effort: "low" | "medium" | "high";

  // Context & Token Limits
  context_window: number;
  max_output_tokens: number;

  // Pricing (per 1M tokens)
  input_price_per_1m: number;
  cached_input_price_per_1m: number;
  output_price_per_1m: number;

  // Execution
  timeout_ms: number;
  routing_arm_id?: string;
  resolution_source: "arm_override" | "explicit_model" | "bandit_ranked" | "global_policy";
}

export interface ResolveModelContext {
  task_type?: string;          // 'code', 'research', 'dossier', 'chat', 'financial_synthesis', 'general'
  mode?: "ask" | "agent" | "background" | "batch";
  workspace_id?: string;
  tenant_id?: string;
  require_tools?: boolean;
  require_vision?: boolean;
  require_json?: boolean;
  routing_arm_id?: string;     // Path A: Explicit routing arm override
  explicit_model_key?: string; // Path B: Explicit requested model
}

/**
 * Authoritative Model Resolver for AgentSam runtime.
 * Implements the 4-path resolution hierarchy with strict fail-loud behavior.
 * Zero emergency fallbacks or hardcoded default models.
 */
export class ModelResolver {
  /**
   * Primary entry point: Resolves the exact model record for the requested task.
   */
  static async resolveModelForTask(
    env: Record<string, any> = {},
    context: ResolveModelContext = {}
  ): Promise<ResolvedModel> {
    const taskType = context.task_type || "general";
    const mode = context.mode || "agent";
    const db = await getDatabase();

    // =========================================================================
    // PATH A: Explicit Routing Arm
    // =========================================================================
    if (context.routing_arm_id) {
      const armRes = await db.query(
        `SELECT 
           a.id as arm_id, a.arm_key, a.model_key, a.provider,
           a.is_active as arm_active, a.is_paused, a.is_ineligible, a.budget_exhausted as arm_budget_exhausted
         FROM agentsam_routing_arms a
         WHERE a.id = ? OR a.arm_key = ?
         LIMIT 1`,
        [context.routing_arm_id, context.routing_arm_id]
      );

      if (armRes.results && armRes.results.length > 0) {
        const arm = armRes.results[0];
        if (arm.arm_active === 1 && arm.is_paused === 0 && arm.is_ineligible === 0 && arm.arm_budget_exhausted === 0) {
          const modelRecord = await this.loadModelRecord(arm.model_key, context);
          if (modelRecord) {
            const healthOk = await this.checkModelHealth(arm.model_key);
            if (healthOk) {
              return {
                ...modelRecord,
                routing_arm_id: arm.arm_id,
                resolution_source: "arm_override",
              };
            }
          }
        }
      }
      throw new Error(`[ModelResolver:PathA] Explicit routing arm '${context.routing_arm_id}' is unavailable or ineligible.`);
    }

    // =========================================================================
    // PATH B: Explicitly Requested Model
    // =========================================================================
    if (context.explicit_model_key) {
      const modelRecord = await this.loadModelRecord(context.explicit_model_key, context);
      if (!modelRecord) {
        throw new Error(`[ModelResolver:PathB] Explicitly requested model '${context.explicit_model_key}' not found in catalog or fails capability constraints.`);
      }

      const healthOk = await this.checkModelHealth(context.explicit_model_key);
      if (!healthOk) {
        throw new Error(`[ModelResolver:PathB] Explicitly requested model '${context.explicit_model_key}' is currently unavailable (circuit breaker tripped).`);
      }

      // Ensure an observed routing arm exists so explicit usage contributes to Bayesian learning
      const armId = await this.ensureObservedModelRoutingArm(context.explicit_model_key, modelRecord.provider, taskType, mode);

      return {
        ...modelRecord,
        routing_arm_id: armId,
        resolution_source: "explicit_model",
      };
    }

    // =========================================================================
    // PATH C: Normal Automatic Routing (JOIN catalog + arms + health + Thompson draws)
    // =========================================================================
    const eligibleArmsRes = await db.query(
      `SELECT 
         a.id as arm_id, a.arm_key, a.model_key, a.provider,
         a.alpha, a.beta, a.pull_count, a.avg_reward, a.priority,
         c.is_active as catalog_active, c.budget_exhausted as catalog_budget_exhausted,
         c.supports_tools, c.supports_vision, c.supports_json_mode
       FROM agentsam_routing_arms a
       INNER JOIN agentsam_model_catalog c ON c.model_key = a.model_key
       WHERE (a.task_type = ? OR a.task_type = '*')
         AND (a.mode = ? OR a.mode = '*')
         AND a.is_active = 1
         AND a.is_paused = 0
         AND a.is_ineligible = 0
         AND a.budget_exhausted = 0
         AND c.is_active = 1
         AND c.budget_exhausted = 0`,
      [taskType, mode]
    );

    const candidates = eligibleArmsRes.results || [];
    const validCandidates: any[] = [];

    // Filter by capabilities
    for (const cand of candidates) {
      if (context.require_tools && cand.supports_tools !== 1) continue;
      if (context.require_vision && cand.supports_vision !== 1) continue;
      if (context.require_json && cand.supports_json_mode !== 1) continue;
      validCandidates.push(cand);
    }

    if (validCandidates.length > 0) {
      // Thompson Sampling draws
      const scoredCandidates = validCandidates.map((cand) => {
        const a = Number(cand.alpha) || 1.0;
        const b = Number(cand.beta) || 1.0;
        const draw = this.sampleBeta(a, b);
        const priorityBonus = (Number(cand.priority) || 100) / 1000;
        return {
          ...cand,
          score: draw + priorityBonus,
        };
      });

      // Rank candidates descending
      scoredCandidates.sort((x, y) => y.score - x.score);

      // Iterate through ranked candidate set and resolve the first available healthy model
      for (const cand of scoredCandidates) {
        const isHealthy = await this.checkModelHealth(cand.model_key);
        if (!isHealthy) continue;

        const modelRecord = await this.loadModelRecord(cand.model_key, context);
        if (modelRecord) {
          return {
            ...modelRecord,
            routing_arm_id: cand.arm_id,
            resolution_source: "bandit_ranked",
          };
        }
      }
    }

    // =========================================================================
    // PATH D: D1 Global Policy Fallback (Highest priority eligible arm for task)
    // =========================================================================
    const globalArmRes = await db.query(
      `SELECT 
         a.id as arm_id, a.model_key, a.provider
       FROM agentsam_routing_arms a
       INNER JOIN agentsam_model_catalog c ON c.model_key = a.model_key
       WHERE (a.task_type = ? OR a.task_type = '*')
         AND (a.mode = ? OR a.mode = '*')
         AND a.is_active = 1
         AND a.is_paused = 0
         AND a.is_ineligible = 0
         AND a.budget_exhausted = 0
         AND c.is_active = 1
         AND c.budget_exhausted = 0
       ORDER BY a.priority DESC, (a.alpha / (a.alpha + a.beta)) DESC
       LIMIT 10`,
      [taskType, mode]
    );

    for (const arm of globalArmRes.results || []) {
      const isHealthy = await this.checkModelHealth(arm.model_key);
      if (!isHealthy) continue;

      const modelRecord = await this.loadModelRecord(arm.model_key, context);
      if (modelRecord) {
        return {
          ...modelRecord,
          routing_arm_id: arm.arm_id,
          resolution_source: "global_policy",
        };
      }
    }

    // =========================================================================
    // FAIL LOUD: No Eligible Arm Found
    // =========================================================================
    throw new Error(
      `[ModelResolver:NO_ELIGIBLE_ARM] No eligible active and healthy model arm found in catalog for task_type='${taskType}', mode='${mode}', require_tools=${!!context.require_tools}.`
    );
  }

  /**
   * Loads full ResolvedModel metadata from agentsam_model_catalog (SSOT).
   */
  static async loadModelRecord(
    modelKey: string,
    context: ResolveModelContext = {}
  ): Promise<ResolvedModel | null> {
    const db = await getDatabase();
    const res = await db.query(
      `SELECT * FROM agentsam_model_catalog WHERE model_key = ? AND is_active = 1 LIMIT 1`,
      [modelKey]
    );

    if (!res.results || res.results.length === 0) {
      return null;
    }

    const row = res.results[0];

    // Capability Validation
    if (context.require_tools && row.supports_tools !== 1) return null;
    if (context.require_vision && row.supports_vision !== 1) return null;
    if (context.require_json && row.supports_json_mode !== 1) return null;
    if (row.budget_exhausted === 1) return null;

    return {
      model_key: row.model_key,
      model_catalog_id: row.id,
      provider: row.provider,
      api_platform: row.api_platform || "standard",
      provider_model_id: row.provider_model_id || row.model_key,
      routing_lane: row.routing_lane || "primary",
      display_name: row.display_name || row.model_key,

      supports_tools: row.supports_tools === 1,
      supports_vision: row.supports_vision === 1,
      supports_json_mode: row.supports_json_mode === 1,
      supports_streaming: row.supports_streaming === 1,
      supports_reasoning: row.supports_reasoning === 1,
      supports_code_execution: row.supports_code_execution === 1,
      reasoning_effort: row.reasoning_effort || "medium",

      context_window: Number(row.context_window) || 128000,
      max_output_tokens: Number(row.max_output_tokens) || 8192,

      input_price_per_1m: Number(row.input_price_per_1m) || 0.0,
      cached_input_price_per_1m: Number(row.cached_input_price_per_1m) || 0.0,
      output_price_per_1m: Number(row.output_price_per_1m) || 0.0,

      timeout_ms: Number(row.timeout_ms) || 60000,
      resolution_source: "global_policy",
    };
  }

  /**
   * Health Circuit Breaker: Verifies that model is not in 'unavailable' state or rate limited.
   */
  static async checkModelHealth(modelKey: string): Promise<boolean> {
    const db = await getDatabase();
    const res = await db.query(
      `SELECT health_status, rate_limited_until, quota_exhausted_until, consecutive_failures
       FROM agentsam_model_health
       WHERE model_key = ?
       LIMIT 1`,
      [modelKey]
    );

    if (!res.results || res.results.length === 0) {
      // Default to healthy if not explicitly tracked
      return true;
    }

    const row = res.results[0];
    const now = Math.floor(Date.now() / 1000);

    if (row.health_status === "unavailable") return false;
    if (row.rate_limited_until && row.rate_limited_until > now) return false;
    if (row.quota_exhausted_until && row.quota_exhausted_until > now) return false;
    if (row.consecutive_failures >= 5) return false;

    return true;
  }

  /**
   * Dynamic Arm Creation: Ensures an observed arm exists for explicit model requests
   * so explicit model usage contributes to learning rather than bypassing bandits.
   */
  static async ensureObservedModelRoutingArm(
    modelKey: string,
    provider: string,
    taskType: string,
    mode: string
  ): Promise<string> {
    const db = await getDatabase();
    const armKey = `arm:${taskType}:${mode}:${modelKey}`;

    const existing = await db.query(
      `SELECT id FROM agentsam_routing_arms WHERE arm_key = ? LIMIT 1`,
      [armKey]
    );

    if (existing.results && existing.results.length > 0) {
      return existing.results[0].id;
    }

    const armId = "arm_" + crypto.randomBytes(8).toString("hex");
    await db.query(
      `INSERT OR REPLACE INTO agentsam_routing_arms (
        id, arm_key, task_type, mode, provider, model_key, alpha, beta, pull_count, avg_reward, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, 2.0, 1.0, 0, 0.0, 1)`,
      [armId, armKey, taskType, mode, provider, modelKey]
    );

    return armId;
  }

  /**
   * Beta distribution sampling for Thompson Routing.
   */
  private static sampleBeta(alpha: number, beta: number): number {
    const a = Math.max(0.1, alpha);
    const b = Math.max(0.1, beta);
    const u1 = Math.max(1e-10, Math.random());
    const u2 = Math.max(1e-10, Math.random());
    // Fast approximation of Beta via Gamma ratio
    const g1 = Math.pow(u1, 1 / a);
    const g2 = Math.pow(u2, 1 / b);
    return g1 / (g1 + g2);
  }
}

export const resolveModelForTask = ModelResolver.resolveModelForTask.bind(ModelResolver);

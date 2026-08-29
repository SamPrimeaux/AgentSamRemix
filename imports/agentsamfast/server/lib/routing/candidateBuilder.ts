import { ActionFeaturesInput } from "./featureSchema.ts";
import { getDatabase } from "../../db/database.ts";

/**
 * Dynamic Candidate Fleet Builder.
 * Replaces hardcoded arrays with a dynamic builder querying the model catalog,
 * capabilities, routing arms, and runtime provider health.
 */
export class CandidateActionBuilder {
  /**
   * Builds candidate actions dynamically from the model catalog and arms registry.
   */
  static async buildCandidates(taskType: string = "general"): Promise<ActionFeaturesInput[]> {
    try {
      const db = await getDatabase();
      const catalogRes = await db.query(
        `SELECT 
           c.id as catalog_id,
           c.provider,
           c.model_key,
           c.display_name,
           c.context_window,
           c.cost_per_input_token,
           c.cost_per_output_token,
           c.is_active,
           a.id as arm_id,
           a.arm_key,
           a.alpha,
           a.beta,
           a.pull_count,
           a.avg_reward,
           a.config_json
         FROM agentsam_model_catalog c
         LEFT JOIN agentsam_routing_arms a 
           ON a.model_key = c.model_key AND a.task_type = ? AND a.is_active = 1
         WHERE c.is_active = 1
         ORDER BY c.provider ASC, c.model_key ASC`,
        [taskType]
      );

      if (catalogRes.results && catalogRes.results.length > 0) {
        const candidates: ActionFeaturesInput[] = [];

        for (const row of catalogRes.results) {
          const provider = (row.provider || "google").toLowerCase();
          const modelKey = row.model_key;
          const contextWindow = Number(row.context_window) || 128000;
          const costIn = Number(row.cost_per_input_token) || 0;
          const costOut = Number(row.cost_per_output_token) || 0;
          const totalCostEst = costIn * 1000 + costOut * 1000;

          // Estimate cost tier in [0.0, 1.0]
          const costTier = totalCostEst > 0.01 ? 0.9 : totalCostEst > 0.002 ? 0.5 : 0.15;
          const contextTier = contextWindow >= 1000000 ? 1.0 : contextWindow >= 128000 ? 0.8 : 0.3;

          // Prior performance from Bayesian arm
          const alpha = Number(row.alpha) || 1.0;
          const beta = Number(row.beta) || 1.0;
          const pulls = Number(row.pull_count) || 0;
          const priorSuccess = pulls > 0 ? alpha / (alpha + beta) : 0.90;

          // Provider health check
          let providerHealth: "healthy" | "degraded" | "rate_limited" = "healthy";
          if (provider === "google" && !process.env.GEMINI_API_KEY) {
            providerHealth = "degraded";
          } else if (provider === "openai" && (!process.env.OPENAI_API_KEY || process.env.OPENAI_BUDGET_EXHAUSTED === "true")) {
            providerHealth = "degraded";
          }

          let modelFamily: "gemini" | "claude" | "gpt" | "workers_ai" | "local" | "other" = "gemini";
          if (provider === "openai" || modelKey.includes("gpt") || modelKey.includes("o1") || modelKey.includes("o3")) {
            modelFamily = "gpt";
          } else if (provider === "anthropic" || modelKey.includes("claude")) {
            modelFamily = "claude";
          } else if (provider === "workers_ai" || provider === "workers-ai") {
            modelFamily = "workers_ai";
          } else if (provider === "local" || provider === "ollama") {
            modelFamily = "local";
          } else if (provider !== "google") {
            modelFamily = "other";
          }

          let reasoningEffort: "low" | "medium" | "high" = "medium";
          if (modelKey.includes("flash-lite") || modelKey.includes("mini") || modelKey.includes("haiku")) {
            reasoningEffort = "low";
          } else if (modelKey.includes("pro") || modelKey.includes("antigravity") || modelKey.includes("opus") || modelKey.includes("o3")) {
            reasoningEffort = "high";
          }

          candidates.push({
            armId: row.arm_id || undefined,
            modelKey,
            provider,
            modelFamily,
            costTier,
            supportsTools: true,
            reasoningEffort,
            contextWindowTier: contextTier,
            structuredOutputCapability: true,
            historicalModelSuccessPriorToT: priorSuccess,
            historicalLatencyMsPriorToT: reasoningEffort === "high" ? 3500 : reasoningEffort === "medium" ? 1500 : 700,
            providerHealth,
          });
        }

        if (candidates.length > 0) {
          return candidates;
        }
      }
    } catch (e) {
      // Database not ready or fallback
    }

    // Default registered catalog fleet
    const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);

    return [
      {
        modelKey: "gemini-2.5-flash",
        provider: "google",
        modelFamily: "gemini",
        costTier: 0.15,
        supportsTools: true,
        reasoningEffort: "medium",
        contextWindowTier: 1.0,
        structuredOutputCapability: true,
        historicalModelSuccessPriorToT: 0.90,
        historicalLatencyMsPriorToT: 1100,
        providerHealth: hasGeminiKey ? "healthy" : "degraded",
      },
      {
        modelKey: "perseus-antigravity",
        provider: "google",
        modelFamily: "gemini",
        costTier: 0.50,
        supportsTools: true,
        reasoningEffort: "high",
        contextWindowTier: 1.0,
        structuredOutputCapability: true,
        historicalModelSuccessPriorToT: 0.94,
        historicalLatencyMsPriorToT: 2200,
        providerHealth: hasGeminiKey ? "healthy" : "degraded",
      },
      {
        modelKey: "gemini-2.5-pro",
        provider: "google",
        modelFamily: "gemini",
        costTier: 0.90,
        supportsTools: true,
        reasoningEffort: "high",
        contextWindowTier: 1.0,
        structuredOutputCapability: true,
        historicalModelSuccessPriorToT: 0.96,
        historicalLatencyMsPriorToT: 4200,
        providerHealth: hasGeminiKey ? "healthy" : "degraded",
      },
    ];
  }
}

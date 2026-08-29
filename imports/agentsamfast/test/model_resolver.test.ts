import { describe, it, expect, beforeAll } from "vitest";
import { getDatabase } from "../server/db/database.ts";
import { ModelResolver, ResolvedModel } from "../server/lib/routing/resolveModelForTask.ts";

describe("AgentSam Dynamic Model Resolver (resolveModelForTask) Authority Tests", () => {
  beforeAll(async () => {
    const db = await getDatabase();
    // Ensure catalog, arms, and health tables exist and are seeded
    await db.exec(`
      CREATE TABLE IF NOT EXISTS agentsam_model_catalog (
        id TEXT PRIMARY KEY,
        model_key TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL,
        api_platform TEXT NOT NULL DEFAULT 'standard',
        provider_model_id TEXT NOT NULL,
        routing_lane TEXT NOT NULL DEFAULT 'primary',
        display_name TEXT NOT NULL,
        supports_tools INTEGER NOT NULL DEFAULT 1,
        supports_vision INTEGER NOT NULL DEFAULT 0,
        supports_json_mode INTEGER NOT NULL DEFAULT 1,
        supports_streaming INTEGER NOT NULL DEFAULT 1,
        supports_reasoning INTEGER NOT NULL DEFAULT 0,
        supports_code_execution INTEGER NOT NULL DEFAULT 1,
        reasoning_effort TEXT DEFAULT 'medium',
        context_window INTEGER NOT NULL DEFAULT 128000,
        max_output_tokens INTEGER NOT NULL DEFAULT 8192,
        input_price_per_1m REAL NOT NULL DEFAULT 0.0,
        cached_input_price_per_1m REAL NOT NULL DEFAULT 0.0,
        output_price_per_1m REAL NOT NULL DEFAULT 0.0,
        timeout_ms INTEGER NOT NULL DEFAULT 60000,
        is_active INTEGER NOT NULL DEFAULT 1,
        budget_exhausted INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS agentsam_routing_arms (
        id TEXT PRIMARY KEY,
        arm_key TEXT NOT NULL UNIQUE,
        task_type TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT '*',
        provider TEXT NOT NULL,
        model_key TEXT NOT NULL,
        alpha REAL NOT NULL DEFAULT 1.0,
        beta REAL NOT NULL DEFAULT 1.0,
        pull_count INTEGER NOT NULL DEFAULT 0,
        avg_reward REAL NOT NULL DEFAULT 0.0,
        is_active INTEGER NOT NULL DEFAULT 1,
        is_paused INTEGER NOT NULL DEFAULT 0,
        is_ineligible INTEGER NOT NULL DEFAULT 0,
        budget_exhausted INTEGER NOT NULL DEFAULT 0,
        priority INTEGER NOT NULL DEFAULT 100
      );

      CREATE TABLE IF NOT EXISTS agentsam_model_health (
        id TEXT PRIMARY KEY,
        model_key TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL,
        health_status TEXT NOT NULL DEFAULT 'healthy',
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        rate_limited_until INTEGER,
        quota_exhausted_until INTEGER
      );

      INSERT OR REPLACE INTO agentsam_model_catalog (
        id, model_key, provider, api_platform, provider_model_id, routing_lane, display_name,
        supports_tools, supports_vision, supports_json_mode, supports_streaming, supports_reasoning,
        supports_code_execution, reasoning_effort, context_window, max_output_tokens,
        input_price_per_1m, output_price_per_1m, timeout_ms, is_active
      ) VALUES 
        ('cat_gemini_35_flash', 'gemini-3.5-flash', 'google', 'gemini_api', 'gemini-3.5-flash', 'primary', 'Gemini 3.5 Flash', 1, 1, 1, 1, 0, 1, 'medium', 1048576, 8192, 0.075, 0.30, 45000, 1),
        ('cat_gemini_35_pro', 'gemini-3.5-pro', 'google', 'gemini_api', 'gemini-3.5-pro', 'reasoning', 'Gemini 3.5 Pro', 1, 1, 1, 1, 1, 1, 'high', 2097152, 8192, 1.25, 5.00, 90000, 1),
        ('cat_claude_37_sonnet', 'claude-3-7-sonnet-20250219', 'anthropic', 'anthropic_api', 'claude-3-7-sonnet-20250219', 'reasoning', 'Claude 3.7 Sonnet', 1, 1, 1, 1, 1, 1, 'high', 200000, 8192, 3.00, 15.00, 90000, 1);

      INSERT OR REPLACE INTO agentsam_routing_arms (
        id, arm_key, task_type, mode, provider, model_key, alpha, beta, is_active, priority
      ) VALUES 
        ('arm_code_flash', 'arm:code:*:gemini-3.5-flash', 'code', '*', 'google', 'gemini-3.5-flash', 10.0, 1.0, 1, 100),
        ('arm_code_pro', 'arm:code:*:gemini-3.5-pro', 'code', '*', 'google', 'gemini-3.5-pro', 15.0, 1.0, 1, 95);

      INSERT OR REPLACE INTO agentsam_model_health (
        id, model_key, provider, health_status, consecutive_failures
      ) VALUES 
        ('hlth_gemini_35_flash', 'gemini-3.5-flash', 'google', 'healthy', 0),
        ('hlth_gemini_35_pro', 'gemini-3.5-pro', 'google', 'healthy', 0),
        ('hlth_claude_37_sonnet', 'claude-3-7-sonnet-20250219', 'anthropic', 'healthy', 0);
    `);
  });

  describe("Path A: Explicit Routing Arm Override", () => {
    it("should resolve catalog model for a valid active routing arm", async () => {
      const resolved = await ModelResolver.resolveModelForTask({}, {
        routing_arm_id: "arm_code_pro",
      });

      expect(resolved.model_key).toBe("gemini-3.5-pro");
      expect(resolved.provider).toBe("google");
      expect(resolved.supports_tools).toBe(true);
      expect(resolved.supports_reasoning).toBe(true);
      expect(resolved.reasoning_effort).toBe("high");
      expect(resolved.resolution_source).toBe("arm_override");
      expect(resolved.routing_arm_id).toBe("arm_code_pro");
    });

    it("should fail loud if explicit arm is paused or non-existent", async () => {
      await expect(
        ModelResolver.resolveModelForTask({}, {
          routing_arm_id: "arm_non_existent",
        })
      ).rejects.toThrow(/Explicit routing arm 'arm_non_existent' is unavailable or ineligible/);
    });
  });

  describe("Path B: Explicitly Requested Model", () => {
    it("should resolve explicit model and dynamically ensure an observed arm for learning", async () => {
      const resolved = await ModelResolver.resolveModelForTask({}, {
        explicit_model_key: "claude-3-7-sonnet-20250219",
        task_type: "research",
        mode: "agent",
      });

      expect(resolved.model_key).toBe("claude-3-7-sonnet-20250219");
      expect(resolved.provider).toBe("anthropic");
      expect(resolved.api_platform).toBe("anthropic_api");
      expect(resolved.resolution_source).toBe("explicit_model");
      expect(resolved.routing_arm_id).toBeDefined();

      // Verify the dynamic arm was created in D1
      const db = await getDatabase();
      const armRes = await db.query(
        `SELECT * FROM agentsam_routing_arms WHERE model_key = 'claude-3-7-sonnet-20250219' AND task_type = 'research'`
      );
      expect(armRes.results.length).toBeGreaterThan(0);
    });
  });

  describe("Path C: Automatic Routing (JOIN catalog + arms + health + Thompson)", () => {
    it("should automatically select an eligible, active, and healthy model arm", async () => {
      const resolved = await ModelResolver.resolveModelForTask({}, {
        task_type: "code",
        mode: "agent",
        require_tools: true,
      });

      expect(["gemini-3.5-flash", "gemini-3.5-pro"]).toContain(resolved.model_key);
      expect(resolved.supports_tools).toBe(true);
      expect(resolved.resolution_source).toBe("bandit_ranked");
    });
  });

  describe("Model Health Circuit Breaker & Fail Loud", () => {
    it("should bypass unavailable models in routing without mutating catalog", async () => {
      const db = await getDatabase();
      // Mark gemini-3.5-flash as unavailable
      await db.query(
        `UPDATE agentsam_model_health SET health_status = 'unavailable' WHERE model_key = 'gemini-3.5-flash'`
      );

      const resolved = await ModelResolver.resolveModelForTask({}, {
        task_type: "code",
        mode: "agent",
      });

      // Should bypass flash and resolve pro
      expect(resolved.model_key).toBe("gemini-3.5-pro");

      // Reset health
      await db.query(
        `UPDATE agentsam_model_health SET health_status = 'healthy' WHERE model_key = 'gemini-3.5-flash'`
      );
    });

    it("should throw NO_ELIGIBLE_ARM when all candidate arms fail health or capability constraints", async () => {
      await expect(
        ModelResolver.resolveModelForTask({}, {
          task_type: "non_existent_impossible_task_999",
          mode: "batch",
        })
      ).rejects.toThrow(/NO_ELIGIBLE_ARM/);
    });
  });
});

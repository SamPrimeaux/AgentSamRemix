/**
 * Midnight usage rollup — D1 agentsam_usage_rollups_daily only (SQL, no LLM).
 * Postgres agentsam.agentsam_usage_events was retired; D1 remains spend SSOT.
 */

import { rollupAgentsamUsageDaily } from '../../backend/services/retention.js';

/**
 * D1 daily rollup into agentsam_usage_rollups_daily (yesterday UTC).
 * @param {any} env
 */
export async function runD1UsageRollupDaily(env) {
  return rollupAgentsamUsageDaily(env);
}

/**
 * Full midnight usage rollup pipeline.
 * @param {any} env
 */
export async function runMidnightUsageRollupPipeline(env) {
  const d1Rollup = await runD1UsageRollupDaily(env);
  return {
    ok: d1Rollup?.ok !== false,
    rowsRead: 0,
    rowsWritten: Number(d1Rollup?.changes) || 0,
    metadata: {
      d1_rollup: d1Rollup,
    },
  };
}

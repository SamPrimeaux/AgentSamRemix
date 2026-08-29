/**
 * Attribute the preceding model decision-turn usage onto agentsam_tool_call_log rows.
 *
 * agent_run remains SSOT for run totals. Tool rows get an equal split of the turn that
 * proposed them so free tools no longer show 0/0/$0 after a real billed turn.
 * SUM(tool tokens) ≈ Σ decision turns that emitted tools (excludes text-only final turns).
 */
import { fetchModelCostUsd } from './agent-model-resolver.js';
import { emptyUsageTokens } from './openai-usage-tokens.js';

/**
 * @param {ReturnType<typeof emptyUsageTokens>|null|undefined} after
 * @param {ReturnType<typeof emptyUsageTokens>|null|undefined} before
 */
export function usageTokensDelta(after, before) {
  const a = after && typeof after === 'object' ? after : emptyUsageTokens();
  const b = before && typeof before === 'object' ? before : emptyUsageTokens();
  return {
    input_tokens: Math.max(0, (Number(a.input_tokens) || 0) - (Number(b.input_tokens) || 0)),
    output_tokens: Math.max(0, (Number(a.output_tokens) || 0) - (Number(b.output_tokens) || 0)),
    cache_read_input_tokens: Math.max(
      0,
      (Number(a.cache_read_input_tokens) || 0) - (Number(b.cache_read_input_tokens) || 0),
    ),
    cache_creation_input_tokens: Math.max(
      0,
      (Number(a.cache_creation_input_tokens) || 0) - (Number(b.cache_creation_input_tokens) || 0),
    ),
  };
}

/**
 * @param {number} total
 * @param {number} n
 * @param {number} index
 */
function splitInt(total, n, index) {
  const t = Math.max(0, Math.floor(Number(total) || 0));
  const slots = Math.max(1, Math.floor(Number(n) || 0) || 1);
  const base = Math.floor(t / slots);
  const rem = t - base * slots;
  return base + (index < rem ? 1 : 0);
}

/**
 * @param {any} env
 * @param {string|null|undefined} modelKey
 * @param {ReturnType<typeof emptyUsageTokens>|null|undefined} turnUsage
 * @param {number} slotCount
 * @returns {Promise<Array<{ inputTokens: number, outputTokens: number, costUsd: number }>>}
 */
export async function allocateDecisionTurnUsageShares(env, modelKey, turnUsage, slotCount) {
  const n = Math.max(1, Math.floor(Number(slotCount) || 0) || 1);
  const tin = Math.max(0, Math.floor(Number(turnUsage?.input_tokens) || 0));
  const tout = Math.max(0, Math.floor(Number(turnUsage?.output_tokens) || 0));
  const tcache = Math.max(0, Math.floor(Number(turnUsage?.cache_read_input_tokens) || 0));
  if (!tin && !tout) {
    return Array.from({ length: n }, () => ({ inputTokens: 0, outputTokens: 0, costUsd: 0 }));
  }
  let turnCost = 0;
  try {
    turnCost = Number(await fetchModelCostUsd(env, modelKey, tin, tout, tcache)) || 0;
  } catch {
    turnCost = 0;
  }
  const shares = [];
  for (let i = 0; i < n; i++) {
    const inputTokens = splitInt(tin, n, i);
    const outputTokens = splitInt(tout, n, i);
    const costUsd =
      i === n - 1
        ? Math.max(
            0,
            turnCost - shares.reduce((s, x) => s + (Number(x.costUsd) || 0), 0),
          )
        : turnCost / n;
    shares.push({
      inputTokens,
      outputTokens,
      costUsd: Number.isFinite(costUsd) ? costUsd : 0,
    });
  }
  return shares;
}

/**
 * @param {{
 *   inputTokens?: number,
 *   outputTokens?: number,
 *   inputCostUsd?: number,
 *   outputCostUsd?: number,
 *   totalCostUsd?: number,
 *   modelUsed?: string|null,
 *   provider?: string|null,
 * }} toolUsage
 * @param {{ inputTokens?: number, outputTokens?: number, costUsd?: number }|null|undefined} share
 */
export function mergeToolUsageWithDecisionShare(toolUsage, share) {
  const base = toolUsage && typeof toolUsage === 'object' ? toolUsage : {};
  const s = share && typeof share === 'object' ? share : null;
  const dIn = Math.max(0, Math.floor(Number(s?.inputTokens) || 0));
  const dOut = Math.max(0, Math.floor(Number(s?.outputTokens) || 0));
  const dCost = Math.max(0, Number(s?.costUsd) || 0);
  return {
    inputTokens: Math.max(0, Math.floor(Number(base.inputTokens) || 0)) + dIn,
    outputTokens: Math.max(0, Math.floor(Number(base.outputTokens) || 0)) + dOut,
    inputCostUsd: Math.max(0, Number(base.inputCostUsd) || 0),
    outputCostUsd: Math.max(0, Number(base.outputCostUsd) || 0),
    totalCostUsd: Math.max(0, Number(base.totalCostUsd) || 0) + dCost,
    modelUsed: base.modelUsed ?? null,
    provider: base.provider ?? null,
  };
}

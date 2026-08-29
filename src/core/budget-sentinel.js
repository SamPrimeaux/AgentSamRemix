/**
 * Budget / context pressure checks for dynamic agent handoff between model tiers.
 */

/** Hand off when run cost exceeds this fraction of the routing arm per-call cap. */
export const BUDGET_PRESSURE_HANDOFF = 0.8;

/** Hand off when accumulated input tokens exceed this fraction of catalog context window. */
export const CONTEXT_PRESSURE_HANDOFF = 0.75;

/**
 * @param {{
 *   runCostUsd?: number | null,
 *   maxCostPerCallUsd?: number | null,
 *   inputTokens?: number | null,
 *   contextWindow?: number | null,
 *   budgetThreshold?: number,
 *   contextThreshold?: number,
 * }} p
 * @returns {{
 *   shouldHandoff: boolean,
 *   reason: 'budget' | 'context' | null,
 *   urgency: number,
 *   budgetPressure: number,
 *   contextPressure: number,
 * }}
 */
export function checkBudgetPressure(p = {}) {
  const budgetThreshold =
    Number.isFinite(Number(p.budgetThreshold)) && Number(p.budgetThreshold) > 0
      ? Number(p.budgetThreshold)
      : BUDGET_PRESSURE_HANDOFF;
  const contextThreshold =
    Number.isFinite(Number(p.contextThreshold)) && Number(p.contextThreshold) > 0
      ? Number(p.contextThreshold)
      : CONTEXT_PRESSURE_HANDOFF;

  const cost = Math.max(0, Number(p.runCostUsd) || 0);
  const maxCost = Number(p.maxCostPerCallUsd);
  const tokens = Math.max(0, Number(p.inputTokens) || 0);
  const ctxWin = Number(p.contextWindow);

  const budgetPressure = maxCost > 0 ? cost / maxCost : 0;
  const contextPressure = ctxWin > 0 ? tokens / ctxWin : 0;

  const hitBudget = maxCost > 0 && budgetPressure > budgetThreshold;
  const hitContext = ctxWin > 0 && contextPressure > contextThreshold;

  if (!hitBudget && !hitContext) {
    return {
      shouldHandoff: false,
      reason: null,
      urgency: Math.max(budgetPressure, contextPressure),
      budgetPressure,
      contextPressure,
    };
  }

  const reason = hitBudget ? 'budget' : 'context';
  return {
    shouldHandoff: true,
    reason,
    urgency: Math.max(budgetPressure, contextPressure),
    budgetPressure,
    contextPressure,
  };
}

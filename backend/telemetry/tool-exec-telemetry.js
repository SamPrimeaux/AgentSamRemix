/**
 * Tool execution telemetry SSOT — usage/cost extraction for catalog + chat tool loop.
 *
 * Body relocated from catalog-tool-executor.js `extractUsageMetrics` (was private).
 * Import this module from catalog-tool-executor and agent-tool-loop — do not reimplement
 * field fallbacks elsewhere (avoids dual-extractor drift).
 *
 * Chat ledger write ownership (TELEMETRY-001 Layer 2 + tool_chain twin):
 * When runContext.skipToolCallLog === true (set by agent-tool-loop before
 * dispatchToolCallWithBudget), catalog finalizeTelemetry must NOT INSERT into
 * agentsam_tool_call_log or agentsam_tool_chain. The loop owns both rows via
 * scheduleAgentsamToolCallLog + fireForgetAgentToolChainRow
 * (agent-tool-host-finalize). Reusing this flag is intentional — a second
 * skip_tool_chain_row on this spine would drift from the proven contract.
 */

/**
 * @param {unknown} output
 * @param {string|null} [fallbackModel]
 * @param {string|null} [fallbackProvider]
 * @returns {{
 *   inputTokens: number,
 *   outputTokens: number,
 *   inputCostUsd: number,
 *   outputCostUsd: number,
 *   totalCostUsd: number,
 *   modelUsed: string|null,
 *   provider: string|null,
 * }}
 */
export function extractToolExecUsage(output, fallbackModel = null, fallbackProvider = null) {
  let root = output;
  if (typeof root === 'string') {
    try {
      root = JSON.parse(root);
    } catch {
      root = null;
    }
  }
  if (!root || typeof root !== 'object') {
    return {
      inputTokens: 0,
      outputTokens: 0,
      inputCostUsd: 0,
      outputCostUsd: 0,
      totalCostUsd: 0,
      modelUsed: fallbackModel != null ? String(fallbackModel) : null,
      provider: fallbackProvider != null ? String(fallbackProvider) : null,
    };
  }
  const usageMetadata =
    root.usageMetadata && typeof root.usageMetadata === 'object'
      ? root.usageMetadata
      : root.body?.usageMetadata && typeof root.body.usageMetadata === 'object'
        ? root.body.usageMetadata
        : root.result?.usageMetadata && typeof root.result.usageMetadata === 'object'
          ? root.result.usageMetadata
          : null;
  const usage =
    root.usage && typeof root.usage === 'object'
      ? root.usage
      : root.body?.usage && typeof root.body.usage === 'object'
        ? root.body.usage
        : root.result?.usage && typeof root.result.usage === 'object'
          ? root.result.usage
          : usageMetadata
            ? {
                prompt_tokens: usageMetadata.promptTokenCount ?? usageMetadata.prompt_tokens,
                output_tokens:
                  usageMetadata.candidatesTokenCount ??
                  usageMetadata.output_tokens ??
                  usageMetadata.completion_tokens,
                input_tokens: usageMetadata.promptTokenCount ?? usageMetadata.input_tokens,
                completion_tokens:
                  usageMetadata.candidatesTokenCount ?? usageMetadata.completion_tokens,
                cost_usd: usageMetadata.cost_usd ?? usageMetadata.costUsd,
              }
            : null;
  const inputTokens = Math.max(
    0,
    Math.floor(
      Number(
        usage?.input_tokens ??
          usage?.prompt_tokens ??
          usage?.promptTokenCount ??
          usage?.inputTokens ??
          root.input_tokens ??
          root.body?.input_tokens ??
          root.result?.input_tokens ??
          0,
      ) || 0,
    ),
  );
  const outputTokens = Math.max(
    0,
    Math.floor(
      Number(
        usage?.output_tokens ??
          usage?.completion_tokens ??
          usage?.candidatesTokenCount ??
          usage?.outputTokens ??
          root.output_tokens ??
          root.body?.output_tokens ??
          root.result?.output_tokens ??
          0,
      ) || 0,
    ),
  );
  const totalCostUsd =
    Number(
      usage?.cost_usd ??
        usage?.costUsd ??
        root.cost_usd ??
        root.body?.cost_usd ??
        root.costUsd ??
        root.body?.costUsd ??
        root.result?.cost_usd ??
        0,
    ) || 0;
  const inputCostUsd = Number(usage?.input_cost_usd ?? usage?.inputCostUsd ?? 0) || 0;
  const outputCostUsd = Number(usage?.output_cost_usd ?? usage?.outputCostUsd ?? 0) || 0;
  const modelUsed =
    root.model_key ??
    root.modelKey ??
    root.body?.model_key ??
    root.body?.modelKey ??
    root.model ??
    root.body?.model ??
    fallbackModel;
  const provider = root.provider ?? root.body?.provider ?? fallbackProvider;
  return {
    inputTokens,
    outputTokens,
    inputCostUsd,
    outputCostUsd,
    totalCostUsd,
    modelUsed: modelUsed != null ? String(modelUsed).trim() || null : null,
    provider: provider != null ? String(provider).trim() || null : null,
  };
}

/** @deprecated Intentional transitional alias — delete once nothing outside this file imports `extractUsageMetrics` by name (prefer extractToolExecUsage). */
export const extractUsageMetrics = extractToolExecUsage;

/**
 * @param {Record<string, unknown>|null|undefined} runContext
 * @returns {boolean}
 */
export function shouldSkipCatalogToolCallLog(runContext) {
  if (!runContext || typeof runContext !== 'object') return false;
  return (
    runContext.skipToolCallLog === true ||
    runContext.skip_tool_call_log === true ||
    runContext.ledgerOwner === 'tool_loop' ||
    runContext.ledger_owner === 'tool_loop'
  );
}

/** Same owner as tool_call_log: chat loop writes agentsam_tool_chain once. */
export function shouldSkipCatalogToolChain(runContext) {
  return shouldSkipCatalogToolCallLog(runContext);
}

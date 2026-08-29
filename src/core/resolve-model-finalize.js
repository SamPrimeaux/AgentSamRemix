/**
 * Run finalizer — write telemetry back to agentsam_agent_run after provider calls.
 */

import { computeCostUsd } from './resolve-model-cost.js';

/**
 * @param {object}        env
 * @param {string}        run_id
 * @param {object|null}   resolvedModel
 * @param {object}        usage
 * @param {object}        [opts]
 */
export async function finalizeAgentRun(env, run_id, resolvedModel, usage = {}, opts = {}) {
  if (!run_id) return;
  const {
    input_tokens = 0,
    cached_input_tokens = 0,
    output_tokens = 0,
    reasoning_tokens = 0,
    latency_ms = 0,
  } = usage;

  const cost_usd = resolvedModel
    ? computeCostUsd(resolvedModel, {
        inputTokens: input_tokens,
        cachedInputTokens: cached_input_tokens,
        outputTokens: output_tokens,
      })
    : 0;
  const status = opts.status ?? 'completed';

  const sets = [];
  const binds = [];
  const push = (col, val) => {
    sets.push(`${col} = ?`);
    binds.push(val);
  };

  push('status', status);
  push('input_tokens', Math.max(0, Math.floor(Number(input_tokens) || 0)));
  push('output_tokens', Math.max(0, Math.floor(Number(output_tokens) || 0)));
  push('cost_usd', Number(cost_usd) || 0);
  push('completed_at', new Date().toISOString());

  if (resolvedModel) {
    push('model_id', resolvedModel.model_key);
    push('ai_model_ref', resolvedModel.model_key);
    push('model_key', resolvedModel.model_key);
    push('model_catalog_id', resolvedModel.model_catalog_id ?? null);
  }
  if (opts.error_message != null) push('error_message', String(opts.error_message).slice(0, 8000));

  const optionalCols = {
    cached_input_tokens: Math.max(0, Math.floor(Number(cached_input_tokens) || 0)),
    reasoning_tokens: Math.max(0, Math.floor(Number(reasoning_tokens) || 0)),
    latency_ms: Math.max(0, Math.floor(Number(latency_ms) || 0)),
  };

  try {
    const { results: cols } = await env.DB.prepare(
      `SELECT name FROM pragma_table_info('agentsam_agent_run')`,
    ).all();
    const colSet = new Set(cols.map((c) => c.name));
    for (const [col, val] of Object.entries(optionalCols)) {
      if (colSet.has(col)) push(col, val);
    }
  } catch (_) {
    /* pragma failure — skip optional cols */
  }

  if (!sets.length) return;
  binds.push(run_id);

  try {
    await env.DB.prepare(`UPDATE agentsam_agent_run SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds)
      .run();
  } catch (e) {
    console.error('[finalizeAgentRun]', e?.message ?? e);
  }
}

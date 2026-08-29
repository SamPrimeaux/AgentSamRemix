/**
 * D1 persistence for routing cold-start priors.
 *
 * This is routing-training state, not user memory. Writes are deliberately
 * best-effort so a telemetry failure never interrupts a model response.
 */

export function deriveProvider(modelKey, fallback = null) {
  if (!modelKey) return fallback;
  const key = String(modelKey).toLowerCase();
  if (key.startsWith('gpt-') || key.startsWith('o1')) return 'openai';
  if (key.startsWith('claude-')) return 'anthropic';
  if (key.startsWith('gemini-')) return 'google';
  if (key.startsWith('llama') || key.startsWith('wai-') || key.startsWith('@cf/')) {
    return 'workers_ai';
  }
  if (key.startsWith('deepseek-') || key === 'deepseek-r1' || key === 'deepseek-v3') {
    return 'deepseek';
  }
  if (key.startsWith('qwen') || key.includes('deepseek')) return 'ollama';
  return fallback;
}

/**
 * Update one workspace/task/model prior using an incremental mean.
 *
 * @param {{ DB?: import('@cloudflare/workers-types').D1Database }} env
 * @param {{
 *   workspaceId: string,
 *   taskType: string,
 *   modelKey: string,
 *   provider?: string|null,
 *   success?: boolean,
 *   latencyMs?: number|null,
 *   costUsd?: number|null,
 * }} input
 */
export async function writeRoutingMemoryPrior(env, input = {}) {
  if (!env?.DB || !input.workspaceId || !input.taskType || !input.modelKey) return;

  try {
    const workspaceId = String(input.workspaceId).trim();
    const taskType = String(input.taskType).trim();
    const modelKey = String(input.modelKey).trim();
    if (!workspaceId || !taskType || !modelKey) return;

    const provider =
      input.provider != null && String(input.provider).trim()
        ? String(input.provider).trim()
        : deriveProvider(modelKey, 'unknown');
    const latencyMs =
      input.latencyMs != null && Number.isFinite(Number(input.latencyMs))
        ? Number(input.latencyMs)
        : null;
    const costUsd =
      input.costUsd != null && Number.isFinite(Number(input.costUsd))
        ? Number(input.costUsd)
        : null;
    const existing = await env.DB.prepare(
      `SELECT success_rate, avg_latency_ms, avg_cost_usd, sample_n
         FROM agentsam_model_routing_memory
        WHERE workspace_id = ? AND task_type = ? AND model_key = ?
        LIMIT 1`,
    )
      .bind(workspaceId, taskType, modelKey)
      .first()
      .catch(() => null);

    const sampleN = Number(existing?.sample_n ?? 0) + 1;
    const previousSuccess = Number(existing?.success_rate ?? 0.5);
    const previousLatency = Number(existing?.avg_latency_ms ?? latencyMs ?? 0);
    const previousCost = Number(existing?.avg_cost_usd ?? costUsd ?? 0);
    const successValue = input.success ? 1 : 0;
    const successRate = previousSuccess + (successValue - previousSuccess) / sampleN;
    const avgLatency =
      latencyMs == null
        ? previousLatency
        : previousLatency + (latencyMs - previousLatency) / sampleN;
    const avgCost =
      costUsd == null ? previousCost : previousCost + (costUsd - previousCost) / sampleN;

    await env.DB.prepare(
      `INSERT INTO agentsam_model_routing_memory
         (workspace_id, task_type, model_key, provider,
          success_rate, avg_latency_ms, avg_cost_usd, sample_n,
          last_evaluated_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'),
               strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(task_type, model_key, workspace_id) DO UPDATE SET
         provider = excluded.provider,
         success_rate = excluded.success_rate,
         avg_latency_ms = excluded.avg_latency_ms,
         avg_cost_usd = excluded.avg_cost_usd,
         sample_n = excluded.sample_n,
         last_evaluated_at = excluded.last_evaluated_at,
         updated_at = excluded.updated_at`,
    )
      .bind(
        workspaceId,
        taskType,
        modelKey,
        provider,
        successRate,
        avgLatency,
        avgCost,
        sampleN,
      )
      .run();
  } catch (error) {
    console.warn('[routing-training] prior write', error?.message ?? error);
  }
}

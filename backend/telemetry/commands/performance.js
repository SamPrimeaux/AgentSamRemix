/** Real-time daily command performance aggregate from agentsam_command_run facts. */
function trim(value) { return value == null ? '' : String(value).trim(); }
function integer(value) { return Math.max(0, Math.floor(Number(value) || 0)); }

export async function recordCommandPerformance(env, p = {}) {
  if (!env?.DB) return { ok: false, reason: 'no_db' };
  const tenantId = trim(p.tenantId ?? p.tenant_id);
  const workspaceId = trim(p.workspaceId ?? p.workspace_id);
  const commandId = trim(p.commandId ?? p.command_id);
  const commandSlug = trim(p.commandSlug ?? p.command_slug);
  if (!tenantId || !workspaceId || !commandId) return { ok: false, reason: 'command_scope_required' };

  const metricDate = new Date().toISOString().slice(0, 10);
  const success = p.success === true ? 1 : 0;
  const failure = success ? 0 : 1;
  const durationMs = integer(p.durationMs ?? p.duration_ms);
  const inputTokens = integer(p.inputTokens ?? p.input_tokens);
  const outputTokens = integer(p.outputTokens ?? p.output_tokens);
  const tokens = inputTokens + outputTokens;
  const costUsd = Math.max(0, Number(p.costUsd ?? p.cost_usd) || 0);
  const costCents = costUsd * 100;

  try {
    const updated = await env.DB.prepare(
      `UPDATE agentsam_execution_performance_metrics SET
         execution_count = execution_count + 1,
         success_count = success_count + ?,
         failure_count = failure_count + ?,
         avg_duration_ms = ((avg_duration_ms * execution_count) + ?) / (execution_count + 1),
         min_duration_ms = CASE WHEN min_duration_ms = 0 OR ? < min_duration_ms THEN ? ELSE min_duration_ms END,
         max_duration_ms = CASE WHEN ? > max_duration_ms THEN ? ELSE max_duration_ms END,
         success_rate_percent = 100.0 * (success_count + ?) / (execution_count + 1),
         failure_rate_percent = 100.0 * (failure_count + ?) / (execution_count + 1),
         total_tokens_consumed = total_tokens_consumed + ?,
         input_tokens = input_tokens + ?,
         output_tokens = output_tokens + ?,
         total_cost_usd = total_cost_usd + ?,
         total_cost_cents = total_cost_cents + ?,
         avg_cost_usd = (total_cost_usd + ?) / (execution_count + 1),
         last_seen_at = unixepoch(),
         last_computed_at = unixepoch()
       WHERE tenant_id = ? AND workspace_id = ? AND metric_date = ?
         AND metric_grain = 'daily' AND source_table = 'agentsam_command_run'
         AND command_id = ? AND COALESCE(command_slug, '') = ?`,
    ).bind(
      success, failure, durationMs, durationMs, durationMs, durationMs, durationMs,
      success, failure, tokens, inputTokens, outputTokens, costUsd, costCents, costUsd,
      tenantId, workspaceId, metricDate, commandId, commandSlug,
    ).run();
    const changes = Number(updated?.meta?.changes ?? updated?.changes ?? 0) || 0;
    if (changes > 0) return { ok: true, action: 'updated' };

    await env.DB.prepare(
      `INSERT INTO agentsam_execution_performance_metrics
        (id, tenant_id, workspace_id, metric_date, metric_grain, source_table,
         command_id, command_slug, execution_count, success_count, failure_count,
         avg_duration_ms, min_duration_ms, max_duration_ms,
         success_rate_percent, failure_rate_percent,
         total_tokens_consumed, input_tokens, output_tokens,
         total_cost_usd, total_cost_cents, avg_cost_usd,
         first_seen_at, last_seen_at, last_computed_at)
       VALUES ('epm_' || lower(hex(randomblob(8))), ?, ?, ?, 'daily', 'agentsam_command_run',
         ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch(), unixepoch())`,
    ).bind(
      tenantId, workspaceId, metricDate, commandId, commandSlug || null,
      success, failure, durationMs, durationMs, durationMs,
      success * 100, failure * 100,
      tokens, inputTokens, outputTokens, costUsd, costCents, costUsd,
    ).run();
    return { ok: true, action: 'inserted' };
  } catch (error) {
    return { ok: false, reason: error?.message ?? String(error) };
  }
}

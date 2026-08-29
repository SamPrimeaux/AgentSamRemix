/**
 * API Service: Telemetry & Auditing
 * Handles performance tracking, cost calculation, and spend auditing.
 * Deconstructed from legacy worker.js.
 */
import { resolveTelemetryTenantId } from '../../backend/identity/users/tenant.js';
import { pragmaTableInfo } from '../../backend/services/retention.js';
import { computeUsdFromAgentsamAiRates } from '../../backend/telemetry/model-catalog-cost.js';
import {
  syncUsageTokenColumns,
  usageEventExtraColumnSql,
} from '../../backend/telemetry/usage-events.js';

export { spendLedgerProvider, writeTelemetry, recordUsage } from '../../backend/telemetry/index.js';

/**
 * Log a worker error into agentsam_error_log (SSOT).
 * Keeps Analytics Engine writeDataPoint; no longer writes worker_analytics_errors.
 */
export async function recordWorkerAnalyticsError(
  env,
  { path = '', method = 'GET', status_code = 500, error_message = '', workspaceId = null, tenantId = null } = {},
) {
  const eventId = `wae_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const workerName = 'inneranimalmedia';
  const environment = 'production';
  const pathSlice = String(path || '').slice(0, 500);
  const methodSlice = String(method || 'GET').slice(0, 24);
  const code = Number(status_code);
  const status = Number.isFinite(code) ? code : 500;
  const msg = String(error_message || '').slice(0, 8000);

  try {
    env?.WAE?.writeDataPoint?.({
      indexes: ['worker_error'],
      blobs: [workerName, environment, pathSlice, methodSlice, msg.slice(0, 200)],
      doubles: [status, 1],
    });
  } catch {
    /* non-fatal */
  }

  if (!env?.DB || !msg) return;

  try {
    const { writeAgentsamErrorLog } = await import('../../backend/telemetry/error-log.js');
    const { resolvePlatformWebhookScope } = await import('../../backend/services/webhooks/ledger.js');
    let ws = workspaceId != null ? String(workspaceId).trim() : '';
    let tid = tenantId != null ? String(tenantId).trim() : '';
    if (!ws || !tid) {
      const scope = await resolvePlatformWebhookScope(env, ws || null);
      if (scope?.workspaceId && scope?.tenantId) {
        ws = scope.workspaceId;
        tid = scope.tenantId;
      }
    }
    if (!ws || !tid) {
      console.warn('[recordWorkerAnalyticsError] platform workspace/tenant required');
      return;
    }
    await writeAgentsamErrorLog(env, {
      workspaceId: ws,
      tenantId: tid,
      errorCode: String(status),
      errorType: 'worker_error',
      errorMessage: msg,
      source: 'worker_fetch',
      sourceId: eventId,
      contextJson: JSON.stringify({
        path: pathSlice,
        method: methodSlice,
        status_code: status,
        worker_name: workerName,
        environment,
      }),
    });
  } catch (e) {
    console.warn('[recordWorkerAnalyticsError]', e?.message ?? e);
  }
}

/**
 * Compute USD cost based on D1 model rates.
 */
/** @deprecated Prefer {@link computeUsdFromAgentsamAiRates} — kept for callers passing preloaded rate maps. */
export function computeUsdFromModelRatesRow(
  modelKey,
  ratesRow,
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheWriteTokens,
  cacheWriteTtl = '5m',
) {
  void modelKey;
  return computeUsdFromAgentsamAiRates(ratesRow, {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cacheWriteTtl,
  });
}

/**
 * High-level generation log (course/lesson matched).
 */
export async function insertAiGenerationLog(env, opts) {
  if (!env?.DB || !opts?.generationType) return;
  const tid = resolveTelemetryTenantId(env, opts.tenantId);
  if (!tid) return;
  const wsInsert =
    (opts.workspaceId != null && String(opts.workspaceId).trim() !== '' ? String(opts.workspaceId).trim() : null) ||
    'system'; // system-scoped: no authenticated user context at this path
  if (!wsInsert) return;

  const id = opts.explicitId || 'aigl_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  const now = Math.floor(Date.now() / 1000);
  
  try {
    const tokens = syncUsageTokenColumns(opts.inputTokens, opts.outputTokens);
    const mk = String(opts.model || 'unknown').trim() || 'unknown';
    const usageCols = await pragmaTableInfo(env.DB, 'agentsam_usage_events');
    const extra = usageEventExtraColumnSql(usageCols, {
      tokens_in: tokens.tokens_in,
      tokens_out: tokens.tokens_out,
      task_type: opts.taskType ?? opts.task_type ?? 'generation',
      mode: opts.mode ?? 'agent',
      event_type: String(opts.generationType || 'generation').slice(0, 120),
      model_key: mk,
      model: mk,
    });
    const extraCols = extra.names.length ? `, ${extra.names.join(', ')}` : '';
    const extraPh = extra.names.length ? `, ${extra.placeholders.join(', ')}` : '';
    await env.DB.prepare(
      `INSERT INTO agentsam_usage_events (
        id, tenant_id, workspace_id, agent_name, provider, model, model_key,
        tokens_in, tokens_out, total_tokens, cost_usd, status, event_type, tool_name${extraCols}, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?${extraPh},?)`
    ).bind(
      id,
      tid,
      wsInsert,
      'agent-sam',
      'course_generation',
      mk,
      mk,
      tokens.tokens_in,
      tokens.tokens_out,
      tokens.total_tokens,
      Number(opts.computedCostUsd) || 0,
      (opts.status || 'completed').toLowerCase() === 'completed' ? 'ok' : 'error',
      String(opts.generationType || 'generation').slice(0, 120),
      String(opts.prompt || '').slice(0, 200),
      ...extra.binds,
      now,
    ).run();

    // PHASE 4D — Snapshot context if requested
    // SCHEMA FIX: actual ai_context_versions columns are (context_id, version_number, value_before,
    // value_after, change_reason, changed_by) — not (slug, content_hash, version_data, tenant_id).
    if (opts.contextToSnap && opts.contextId) {
      const snapId = `ctxv_${crypto.randomUUID().replace(/-/g,'').slice(0,12)}`;
      // Get current max version number for this context_id
      const verRow = await env.DB.prepare(
        `SELECT COALESCE(MAX(version_number), 0) as max_v FROM ai_context_versions WHERE context_id = ?`
      ).bind(opts.contextId).first().catch(() => null);
      const nextVer = (verRow?.max_v ?? 0) + 1;
      await env.DB.prepare(`
        INSERT INTO ai_context_versions
          (id, context_id, version_number, value_before, value_after, change_reason, changed_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        snapId, opts.contextId, nextVer,
        opts.valueBefore ?? null,
        JSON.stringify(opts.contextToSnap),
        opts.changeReason || 'generation_log',
        opts.changedBy || 'worker'
      ).run().catch(() => {});
    }
  } catch (e) {
    console.warn('[insertAiGenerationLog] failed:', e.message);
  }
}

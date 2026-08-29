/**
 * WAE error spike check — queries Workers Analytics Engine for the last 20 minutes,
 * fires sendPhoneLoopCompletion (push + email) if 5xx error count exceeds threshold.
 *
 * Real data from CF's telemetry layer — not self-reported by the app.
 * Deduplicates via KV so you get at most one alert per 15-minute window.
 *
 * NOTE: Only catches errors that call recordWorkerAnalyticsError (worker throws + select
 * call sites). Does not count every HTTP 5xx response. Threshold is absolute count only —
 * no rate calculation since we don't have total request volume in the same dataset.
 */
import { sendPhoneLoopCompletion } from '../../src/core/email-agent-bridge.js';
import { startCronRun, completeCronRun, failCronRun } from './cron-run-ledger.js';
import { resolveIamSystemActorId } from '../identity/system-actor.js';
import { resolveCronTenantId, resolveCronWorkspaceId } from './cron-tenant.js';

const CRON_EXPR = '*/20 * * * *';

// Alert threshold: absolute 5xx count in 20-minute window
const ERROR_5XX_THRESHOLD = 10;

/**
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
export async function runWaeErrorSpikeCheck(env, ctx) {
  const begun = await startCronRun(env, {
    jobName: 'wae_error_spike_check',
    cronExpression: CRON_EXPR,
    tenantId: null,
    workspaceId: null,
  }).catch(() => null);
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();

  try {
    const result = await _runCheck(env, ctx);
    if (runId) await completeCronRun(env, runId, startedAt, { rowsRead: result.rowsScanned ?? 0, rowsWritten: result.alerted ? 1 : 0, metadata: result }).catch(() => null);
    return result;
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e).catch(() => null);
    throw e;
  }
}

async function _runCheck(env, ctx) {
  const token = env.CLOUDFLARE_API_TOKEN;
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();

  if (!token) {
    console.warn('[wae-spike] CLOUDFLARE_API_TOKEN not set — skipping');
    return { skipped: true, reason: 'no_token' };
  }
  if (!accountId) {
    console.warn('[wae-spike] CLOUDFLARE_ACCOUNT_ID not set — skipping');
    return { skipped: true, reason: 'no_account_id' };
  }

  // Dedupe: at most one alert per 15-minute window
  const windowKey = Math.floor(Date.now() / (15 * 60 * 1000));
  const dedupeKey = `wae_spike_notified:${windowKey}`;
  const already = await env.KV?.get(dedupeKey).catch(() => null);
  if (already) {
    console.log('[wae-spike] already notified this window — skipping');
    return { skipped: true, reason: 'dedupe' };
  }

  // WAE SQL API — body must be raw SQL string as text/plain, not JSON
  const sql = `
SELECT
  blob1 AS worker,
  blob3 AS path,
  SUM(_sample_interval) AS total_datapoints,
  SUM(IF(double1 >= 500, _sample_interval, 0)) AS error_5xx,
  SUM(IF(double1 >= 400 AND double1 < 500, _sample_interval, 0)) AS error_4xx
FROM inneranimalmedia
WHERE timestamp >= NOW() - INTERVAL '20' MINUTE
  AND index1 = 'worker_error'
GROUP BY blob1, blob3
ORDER BY error_5xx DESC
LIMIT 20
  `.trim();

  let rows = [];
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/plain',
        },
        body: sql,
      },
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn('[wae-spike] WAE query HTTP', res.status, txt.slice(0, 200));
      return { ok: false, reason: `wae_http_${res.status}` };
    }
    const json = await res.json();
    rows = json?.data ?? [];
  } catch (e) {
    console.warn('[wae-spike] fetch failed', e?.message ?? e);
    return { ok: false, reason: 'fetch_error', error: e?.message };
  }

  const rowsScanned = rows.length;

  if (!rowsScanned) {
    console.log('[wae-spike] no error datapoints in window — all clear');
    return { ok: true, spiking: false, totalErrors5xx: 0, rowsScanned: 0 };
  }

  const totalErrors5xx = rows.reduce((n, r) => n + Number(r.error_5xx || 0), 0);
  const totalErrors4xx = rows.reduce((n, r) => n + Number(r.error_4xx || 0), 0);

  console.log(`[wae-spike] 5xx=${totalErrors5xx} 4xx=${totalErrors4xx} paths=${rowsScanned}`);

  if (totalErrors5xx <= ERROR_5XX_THRESHOLD) {
    return { ok: true, spiking: false, totalErrors5xx, totalErrors4xx, rowsScanned };
  }

  // Top failing paths
  const topPaths = rows
    .filter((r) => Number(r.error_5xx) > 0)
    .slice(0, 5)
    .map((r) => `  ${r.path || '(unknown)'} → ${r.error_5xx} 5xx`)
    .join('\n');

  // Mark notified before firing to prevent concurrent double-send
  await env.KV?.put(dedupeKey, '1', { expirationTtl: 15 * 60 }).catch(() => null);

  const subject = `[Agent Sam] ⚠️ ${totalErrors5xx} Worker 5xx errors in last 20min`;
  const body = [
    `Worker error spike detected.`,
    ``,
    `5xx errors: ${totalErrors5xx}`,
    `4xx errors: ${totalErrors4xx}`,
    `Distinct paths: ${rowsScanned}`,
    ``,
    `Top failing paths:`,
    topPaths || `  (no paths isolated)`,
    ``,
    `→ https://dash.cloudflare.com/${accountId}/workers/analytics`,
  ].join('\n');

  // Push + email via phone loop infrastructure
  await sendPhoneLoopCompletion(env, ctx, {
    conversationId: crypto.randomUUID(),
    subject,
    body,
    pushTitle: `⚠️ ${totalErrors5xx} Worker 5xx errors`,
    pushBody: `${totalErrors5xx} errors in last 20min — tap to investigate`,
  }).catch((e) => console.warn('[wae-spike] notify failed', e?.message ?? e));

  // Audit trail — tenant/workspace from env + D1 auth_users (no hardcoded tenant_*/ws_*)
  const operatorUserId = await resolveIamSystemActorId(env);
  const workspaceId = await resolveCronWorkspaceId(env, { userId: operatorUserId });
  const tenantId = await resolveCronTenantId(env, { userId: operatorUserId });
  if (!workspaceId || !tenantId || tenantId === 'system') {
    console.warn('[wae-spike] workspace/tenant unresolved — skipping error_log insert', {
      workspaceId,
      tenantId,
    });
  } else {
    await env.DB?.prepare(`
      INSERT INTO agentsam_error_log
        (id, workspace_id, tenant_id, error_code, error_type, error_message, source, context_json, resolved, created_at)
      VALUES (?, ?, ?, 'wae_error_spike', 'critical', ?, 'wae_cron', ?, 0, unixepoch())
    `).bind(
      `aerr_wae_${Date.now()}`,
      workspaceId,
      tenantId,
      `${totalErrors5xx} 5xx errors in 20min window`,
      JSON.stringify({ totalErrors5xx, totalErrors4xx, rowsScanned, topPaths }),
    ).run().catch((e) => console.warn('[wae-spike] error_log insert failed', e?.message ?? e));
  }

  return { ok: true, spiking: true, alerted: true, totalErrors5xx, totalErrors4xx, rowsScanned };
}

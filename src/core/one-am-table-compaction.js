/**
 * Six-table addendum — rollups and tiered purges for 1 AM compaction pipeline.
 */

import { compactToolCallLogBeforePurge } from './tool-call-log-compaction.js';
import {
  backfillToolStatsFromToolCallLog,
  rollupToolCallLogDailyStats,
} from './tool-stats-rollup.js';
import { patchDailyTopToolsJson, pragmaTableInfo } from '../../backend/services/retention.js';
import { scheduleCompactionEvent } from './agentsam-ops-ledger.js';
import { resolveCronTenantId } from '../../backend/jobs/cron-tenant.js';

/** Max audit→delete cycles per 1 AM run (500 rows/batch → up to 20k aged rows). */
const TOOL_CALL_LOG_PURGE_MAX_BATCHES = 40;

/**
 * patchDailyTopToolsJson → yesterday exact rollup → backfill (7d) → purge batches.
 * Stats live in tool-stats-rollup; purge path is audit-only.
 * @param {any} env
 */
export async function rollupToolCallLogDaily(env) {
  if (!env?.DB) return { ok: false, skipped: true };

  const topTools = await patchDailyTopToolsJson(env);

  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const dayRollup = await rollupToolCallLogDailyStats(env, { metricDate: yesterday });
  const backfill = await backfillToolStatsFromToolCallLog(env, { limitDays: 7 });

  /** @type {Array<{ stats_upserted?: number, rows_about_to_delete?: number, deleted: number }>} */
  const batches = [];
  let deleted = 0;

  const srcCols = await pragmaTableInfo(env.DB, 'agentsam_tool_call_log');
  const tsCol = srcCols.has('created_at_unix')
    ? 'created_at_unix'
    : srcCols.has('created_at')
      ? 'created_at'
      : null;
  if (!tsCol) {
    return {
      ok: false,
      skipped: true,
      reason: 'tool_call_log_schema',
      preferred_source: 'agentsam_tool_call_log',
      topTools,
      dayRollup,
      backfill,
    };
  }

  for (let i = 0; i < TOOL_CALL_LOG_PURGE_MAX_BATCHES; i++) {
    const compaction = await compactToolCallLogBeforePurge(env, { retentionDays: 1 });
    if (!compaction?.ok && compaction?.skipped) {
      if (i === 0) {
        console.log('[compaction]', 'tool_call_log_purge', {
          rowCount: 0,
          reason: compaction.reason || 'skipped',
          source_table: 'agentsam_tool_call_log',
        });
        return {
          ok: true,
          topTools,
          dayRollup,
          backfill,
          compaction,
          deleted: 0,
          batches: 0,
          stats_upserted: Number(dayRollup?.upserted ?? 0) || 0,
        };
      }
      break;
    }
    if (compaction?.skipped && compaction?.reason === 'no_rows_in_purge_batch') {
      break;
    }

    const res = await env.DB.prepare(
      `DELETE FROM agentsam_tool_call_log
       WHERE ${tsCol} < unixepoch('now', '-1 day')
       LIMIT 500`,
    )
      .run()
      .catch((e) => {
        console.warn('[one-am] tool_call_log DELETE', e?.message ?? e);
        return null;
      });

    const batchDeleted = Number(res?.meta?.changes ?? res?.changes ?? 0) || 0;
    deleted += batchDeleted;
    batches.push({
      stats_upserted: 0,
      rows_about_to_delete: compaction?.rows_about_to_delete ?? 0,
      deleted: batchDeleted,
    });

    if (batchDeleted === 0) break;
  }

  const statsUpserted = Number(dayRollup?.upserted ?? 0) || 0;
  console.log('[compaction]', 'tool_call_log_purge', {
    rowCount: deleted,
    batches: batches.length,
    stats_upserted: statsUpserted,
    metric_date: yesterday,
    source_table: 'agentsam_tool_call_log',
  });
  return {
    ok: true,
    topTools,
    dayRollup,
    backfill,
    compaction: batches[0] || { skipped: true, reason: 'no_rows_in_purge_batch' },
    deleted,
    batches: batches.length,
    stats_upserted: statsUpserted,
    source_table: 'agentsam_tool_call_log',
  };
}

/**
 * @param {any} env
 */
export async function purgeExpiredToolCache(env) {
  const { runToolCacheMaintenance } = await import('../../backend/jobs/tool-cache-maintenance.js');
  return runToolCacheMaintenance(env);
}

/**
 * Upsert yesterday's error counts into agentsam_usage_rollups_daily.
 * @param {any} env
 */
export async function rollupErrorLogToDaily(env) {
  if (!env?.DB) return { ok: false, skipped: true };

  const errCols = await pragmaTableInfo(env.DB, 'agentsam_error_log');
  const rollCols = await pragmaTableInfo(env.DB, 'agentsam_usage_rollups_daily');
  if (!errCols.has('created_at') || !errCols.has('error_type') || !rollCols.has('error_count')) {
    return { ok: false, skipped: true, reason: 'schema' };
  }

  const hasBreakdown = rollCols.has('error_breakdown_json');
  const wsExpr = errCols.has('workspace_id') ? 'workspace_id' : `'__tenant__'`;

  const { results: typeRows = [] } = await env.DB.prepare(
    `SELECT tenant_id, ${wsExpr} AS workspace_id, error_type, COUNT(*) AS type_count
     FROM agentsam_error_log
     WHERE date(created_at, 'unixepoch') = date('now', '-1 day')
     GROUP BY tenant_id, ${wsExpr}, error_type`,
  )
    .all()
    .catch(() => ({ results: [] }));

  const byWs = new Map();
  for (const row of typeRows) {
    const tenantId = String(row.tenant_id || '').trim();
    const workspaceId = String(row.workspace_id || '__tenant__').trim();
    if (!tenantId) continue;
    const key = `${tenantId}\0${workspaceId}`;
    if (!byWs.has(key)) {
      byWs.set(key, { tenantId, workspaceId, error_count: 0, breakdown: {} });
    }
    const bucket = byWs.get(key);
    const c = Number(row.type_count) || 0;
    bucket.error_count += c;
    bucket.breakdown[String(row.error_type || 'unknown')] = c;
  }

  let upserted = 0;
  for (const bucket of byWs.values()) {
    const breakdownJson = JSON.stringify(bucket.breakdown);
    try {
      if (hasBreakdown) {
        await env.DB.prepare(
          `INSERT INTO agentsam_usage_rollups_daily
             (tenant_id, workspace_id, day, error_count, error_breakdown_json, rollup_source, rolled_up_at)
           VALUES (?, ?, date('now', '-1 day'), ?, ?, 'error_log_rollup', unixepoch())
           ON CONFLICT (tenant_id, workspace_id, day) DO UPDATE SET
             error_count = agentsam_usage_rollups_daily.error_count + excluded.error_count,
             error_breakdown_json = excluded.error_breakdown_json,
             rolled_up_at = unixepoch()`,
        )
          .bind(bucket.tenantId, bucket.workspaceId, bucket.error_count, breakdownJson)
          .run();
      } else {
        await env.DB.prepare(
          `INSERT INTO agentsam_usage_rollups_daily
             (tenant_id, workspace_id, day, error_count, rollup_source, rolled_up_at)
           VALUES (?, ?, date('now', '-1 day'), ?, 'error_log_rollup', unixepoch())
           ON CONFLICT (tenant_id, workspace_id, day) DO UPDATE SET
             error_count = agentsam_usage_rollups_daily.error_count + excluded.error_count,
             rolled_up_at = unixepoch()`,
        )
          .bind(bucket.tenantId, bucket.workspaceId, bucket.error_count)
          .run();
      }
      upserted += 1;
    } catch (e) {
      console.warn('[one-am] error_log rollup row', e?.message ?? e);
    }
  }

  return { ok: true, upserted };
}

/**
 * Tiered purge: resolved 48h, unresolved 7d — with compaction_event audit.
 * @param {any} env
 */
export async function purgeErrorLog(env) {
  if (!env?.DB) return { deleted: 0 };

  const cols = await pragmaTableInfo(env.DB, 'agentsam_error_log');
  if (!cols.has('created_at') || !cols.has('resolved')) {
    return { deleted: 0, skipped: true };
  }

  await rollupErrorLogToDaily(env);

  const whereClause = `(resolved = 1 AND created_at < unixepoch('now', '-2 days'))
    OR (resolved = 0 AND created_at < unixepoch('now', '-7 days'))`;

  const { results: byType = [] } = await env.DB.prepare(
    `SELECT error_type, COUNT(*) AS c FROM agentsam_error_log
     WHERE ${whereClause}
     GROUP BY error_type`,
  )
    .all()
    .catch(() => ({ results: [] }));

  const totalToDelete = byType.reduce((s, r) => s + (Number(r.c) || 0), 0);
  const by_type = Object.fromEntries(
    byType.map((r) => [String(r.error_type || 'unknown'), Number(r.c) || 0]),
  );

  if (totalToDelete > 0) {
    const tenantId = (await resolveCronTenantId(env)) || 'system';
    scheduleCompactionEvent(env, null, {
      tenantId,
      workspaceId: null,
      userId: 'system',
      provider: 'none',
      modelKey: 'none',
      tokensBefore: 0,
      tokensAfter: 0,
      costSavedUsd: 0,
      compactionStrategy: 'selective',
      metadata: {
        compaction_type: 'data_summary',
        source_table: 'agentsam_error_log',
        source_row_count: totalToDelete,
        summary_json: { by_type },
        trigger: 'one_am_compaction_pipeline',
        status: 'completed',
      },
    });
  }

  const res = await env.DB.prepare(
    `DELETE FROM agentsam_error_log WHERE ${whereClause} LIMIT 500`,
  )
    .run()
    .catch((e) => {
      console.warn('[one-am] error_log DELETE', e?.message ?? e);
      return null;
    });

  const deleted = Number(res?.meta?.changes ?? res?.changes ?? 0) || 0;
  console.log('[compaction]', 'error_log_purge', { rowCount: deleted, by_type });
  return { deleted, by_type, audited: totalToDelete > 0 };
}

/**
 * Summary by hook_id/status, then tiered purge (hook_agent_run_complete @ 7d).
 * @param {any} env
 */
export async function purgeHookExecution(env) {
  if (!env?.DB) return { deleted: 0 };

  const cols = await pragmaTableInfo(env.DB, 'agentsam_hook_execution');
  if (!cols.has('created_at') || !cols.has('hook_id')) {
    return { deleted: 0, skipped: true };
  }

  const purgeWhere = `(hook_id != 'hook_agent_run_complete' AND created_at < unixepoch('now', '-2 days'))
    OR (hook_id = 'hook_agent_run_complete' AND created_at < unixepoch('now', '-7 days'))`;

  const { results: summary = [] } = await env.DB.prepare(
    `SELECT hook_id, status, COUNT(*) AS c FROM agentsam_hook_execution
     WHERE ${purgeWhere}
     GROUP BY hook_id, status`,
  )
    .all()
    .catch(() => ({ results: [] }));

  const totalToDelete = summary.reduce((s, r) => s + (Number(r.c) || 0), 0);
  if (totalToDelete > 0) {
    const byHook = {};
    for (const r of summary) {
      const hid = String(r.hook_id || 'unknown');
      if (!byHook[hid]) byHook[hid] = {};
      byHook[hid][String(r.status || 'unknown')] = Number(r.c) || 0;
    }
    const tenantId = (await resolveCronTenantId(env)) || 'system';
    scheduleCompactionEvent(env, null, {
      tenantId,
      workspaceId: null,
      userId: 'system',
      provider: 'none',
      modelKey: 'none',
      tokensBefore: 0,
      tokensAfter: 0,
      costSavedUsd: 0,
      compactionStrategy: 'selective',
      metadata: {
        compaction_type: 'data_summary',
        source_table: 'agentsam_hook_execution',
        source_row_count: totalToDelete,
        summary_json: { by_hook: byHook },
        trigger: 'one_am_compaction_pipeline',
        status: 'completed',
      },
    });
  }

  const r1 = await env.DB.prepare(
    `DELETE FROM agentsam_hook_execution
     WHERE hook_id != 'hook_agent_run_complete'
       AND created_at < unixepoch('now', '-2 days')
     LIMIT 500`,
  )
    .run()
    .catch(() => null);
  const r2 = await env.DB.prepare(
    `DELETE FROM agentsam_hook_execution
     WHERE hook_id = 'hook_agent_run_complete'
       AND created_at < unixepoch('now', '-7 days')
     LIMIT 500`,
  )
    .run()
    .catch(() => null);

  const deleted =
    (Number(r1?.meta?.changes ?? r1?.changes ?? 0) || 0) +
    (Number(r2?.meta?.changes ?? r2?.changes ?? 0) || 0);
  console.log('[compaction]', 'hook_execution_purge', { rowCount: deleted });
  return { deleted, audited: totalToDelete > 0 };
}

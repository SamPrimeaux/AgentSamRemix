/**
 * Purge audit only for agentsam_tool_call_log.
 *
 * Stats for agentsam_tool_stats_compacted are written exclusively by
 * tool-stats-rollup.js (calendar-day exact UPSERT). This module must NOT
 * INSERT into compacted tables.
 *
 * Order before DELETE: compaction_events audit → caller DELETE.
 */

import { scheduleCompactionEvent } from './agentsam-ops-ledger.js';
import { resolveCronTenantId } from '../../backend/jobs/cron-tenant.js';

const PURGE_BATCH_LIMIT = 500;

async function pragmaTableInfo(db, tableName) {
  const safe = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(tableName || '')) ? String(tableName) : '';
  if (!safe || !db) return new Set();
  try {
    const { results } = await db.prepare(`PRAGMA table_info(${safe})`).all();
    return new Set((results || []).map((r) => String(r.name || '').toLowerCase()));
  } catch {
    return new Set();
  }
}

/**
 * Live log uses tool_key + created_at_unix; older snapshots used tool_name + created_at.
 * @param {Set<string>} srcCols
 * @returns {{ toolCol: string, tsCol: string } | null}
 */
export function resolveToolCallLogCompactColumns(srcCols) {
  if (!srcCols?.size) return null;
  const toolCol = srcCols.has('tool_key')
    ? 'tool_key'
    : srcCols.has('tool_name')
      ? 'tool_name'
      : null;
  const tsCol = srcCols.has('created_at_unix')
    ? 'created_at_unix'
    : srcCols.has('created_at')
      ? 'created_at'
      : null;
  if (!toolCol || !tsCol) return null;
  return { toolCol, tsCol };
}

function purgeAgeClause(tsCol, retentionDays) {
  const days = Math.max(0, Number(retentionDays) || 1);
  const safeTs = tsCol === 'created_at_unix' ? 'created_at_unix' : 'created_at';
  return `${safeTs} < unixepoch('now', '-${days} days')`;
}

/**
 * Audit-only pre-purge: no INSERT into agentsam_tool_stats_compacted.
 * @param {any} env
 * @param {{ retentionDays?: number }} [opts]
 */
export async function compactToolCallLogBeforePurge(env, opts = {}) {
  if (!env?.DB) {
    return { ok: false, skipped: true, reason: 'no_db', stats_upserted: 0 };
  }

  const srcCols = await pragmaTableInfo(env.DB, 'agentsam_tool_call_log');
  const resolved = resolveToolCallLogCompactColumns(srcCols);
  if (!resolved) {
    return { ok: false, skipped: true, reason: 'tool_call_log_schema', stats_upserted: 0 };
  }
  const { toolCol, tsCol } = resolved;

  const ageClause = purgeAgeClause(tsCol, opts.retentionDays);
  const batchCte = `
    WITH purge_batch AS (
      SELECT *
      FROM agentsam_tool_call_log
      WHERE ${ageClause}
      ORDER BY ${tsCol} ASC
      LIMIT ${PURGE_BATCH_LIMIT}
    )`;

  const batchMeta = await env.DB.prepare(
    `${batchCte}
     SELECT COUNT(*) AS row_count,
            COALESCE(SUM(COALESCE(cost_usd, 0)), 0) AS total_cost
     FROM purge_batch`,
  )
    .first()
    .catch(() => null);

  const rowsAboutToDelete = Number(batchMeta?.row_count) || 0;
  if (!rowsAboutToDelete) {
    return { ok: true, skipped: true, reason: 'no_rows_in_purge_batch', stats_upserted: 0 };
  }

  const tenantId = (await resolveCronTenantId(env)) || 'system';
  const wsRow = await env.DB.prepare(
    `${batchCte} SELECT DISTINCT ${
      srcCols.has('workspace_id')
        ? `COALESCE(NULLIF(trim(workspace_id), ''), '__tenant__')`
        : `'__tenant__'`
    } AS workspace_id FROM purge_batch LIMIT 1`,
  )
    .first()
    .catch(() => null);

  /** Distinct agentsam_agent_run.id values on rows about to be purged (migration 164). */
  let agentsamAgentRunIds = [];
  if (srcCols.has('agent_run_id')) {
    const { results: runRows = [] } = await env.DB.prepare(
      `${batchCte}
       SELECT DISTINCT agent_run_id FROM purge_batch
       WHERE agent_run_id IS NOT NULL AND trim(agent_run_id) != ''
       LIMIT 50`,
    )
      .all()
      .catch(() => ({ results: [] }));
    agentsamAgentRunIds = runRows.map((r) => String(r.agent_run_id));
  }

  try {
    scheduleCompactionEvent(env, null, {
      tenantId,
      workspaceId: wsRow?.workspace_id != null ? String(wsRow.workspace_id) : null,
      userId: 'system',
      provider: 'none',
      modelKey: 'none',
      tokensBefore: 0,
      tokensAfter: 0,
      costSavedUsd: Number(batchMeta?.total_cost) || 0,
      compactionStrategy: 'selective',
      metadata: {
        compaction_type: 'data_summary',
        compaction_scope: 'table',
        source_kind: 'd1',
        source_table: 'agentsam_tool_call_log',
        source_row_count: rowsAboutToDelete,
        cost_before_usd: Number(batchMeta?.total_cost) || 0,
        agentsam_agent_run_ids: agentsamAgentRunIds,
        trigger: 'one_am_compaction_pipeline',
        status: 'completed',
        note: 'purge_audit_only_stats_via_tool_stats_rollup',
        compacted_at_epoch: Math.floor(Date.now() / 1000),
      },
    });
    console.log('[compaction]', 'agentsam_compaction_events', {
      table: 'agentsam_tool_call_log_purge',
      rowCount: rowsAboutToDelete,
      note: 'purge_audit_only_stats_via_tool_stats_rollup',
    });
  } catch (e) {
    console.warn('[tool-call-log-compaction] compaction_event', e?.message ?? e);
  }

  return {
    ok: true,
    stats_upserted: 0,
    rows_about_to_delete: rowsAboutToDelete,
    compaction_events: 1,
    source_table: 'agentsam_tool_call_log',
    tool_col: toolCol,
    ts_col: tsCol,
    note: 'purge_audit_only_stats_via_tool_stats_rollup',
  };
}

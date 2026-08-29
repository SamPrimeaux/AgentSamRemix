import { resolveCronTenantId } from './cron-tenant.js';

/** Handled exclusively by runOneAmCompactionPipeline — skip in policy-driven purge. */
const ONE_AM_MANAGED_TABLES = new Set([
  'agentsam_tool_call_log',
  'agentsam_usage_events',
  'agentsam_hook_execution',
]);

export const RETENTION_PURGE_TABLE_CONFIG = {
  agentsam_webhook_events: { dateColumn: 'received_at_unix', compare: 'unix' },
  agentsam_hook_execution: { dateColumn: 'completed_at', compare: 'datetime' },
  agentsam_tool_call_log: { dateColumn: 'created_at', compare: 'unix' },
  agentsam_tool_chain: { dateColumn: 'started_at', compare: 'unix' },
  agentsam_execution_steps: { dateColumn: 'created_at_unix', compare: 'unix' },
  agentsam_cron_runs: { dateColumn: 'started_at', compare: 'unix' },
  worker_analytics_events: { dateColumn: 'timestamp', compare: 'unix_ms' },
  worker_analytics_errors: { dateColumn: 'created_at', compare: 'unix' },
  notifications: { dateColumn: 'created_at', compare: 'datetime' },
  deployment_notifications: { dateColumn: 'created_at', compare: 'datetime' },
  terminal_history: { dateColumn: 'recorded_at', compare: 'unix' },
  agentsam_mcp_tool_execution: { dateColumn: 'created_at', compare: 'datetime' },
  mcp_agent_sessions: { dateColumn: 'created_at', compare: 'unix' },
  agentsam_tool_stats_compacted: { dateColumn: 'date', compare: 'date_col' },
  agentsam_workflow_runs: { dateColumn: 'started_at', compare: 'unix' },
  mcp_command_suggestions: { dateColumn: 'created_at', compare: 'unix' },
  terminal_sessions: { dateColumn: 'updated_at', compare: 'unix' },
  cicd_runs: { dateColumn: 'completed_at', compare: 'unix' },
  cicd_events: { dateColumn: 'created_at', compare: 'unix' },
  agent_messages: { dateColumn: 'created_at', compare: 'datetime' },
  otlp_traces: { dateColumn: 'start_time_unix_nano', compare: 'unix_ns' },
  system_health_snapshots: { dateColumn: 'snapshot_at', compare: 'unix' },
  agentsam_memory: { dateColumn: 'updated_at', compare: 'unix' },
  pty_health_events: { dateColumn: 'recorded_at', compare: 'unix' },
  cicd_benchmark_steps: { dateColumn: 'tested_at', compare: 'datetime' },
  cicd_github_runs: { dateColumn: 'created_at', compare: 'datetime' },
  telemetry_traces: { dateColumn: 'timestamp', compare: 'unix_ms' },
  email_logs: { dateColumn: 'created_at', compare: 'datetime' },
  auth_event_log: { dateColumn: 'created_at', compare: 'datetime' },
  oauth_state_nonces: { dateColumn: 'created_at', compare: 'unix' },
  agentsam_compaction_events: { dateColumn: 'created_at_epoch', compare: 'unix' },
  agentsam_execution_context: { dateColumn: 'created_at', compare: 'unix' },
};

const RETENTION_PURGE_MAX_BATCHES = 40;

/**
 * @param {{ dateColumn: string, compare: string }} cfg
 * @param {number} days
 * @returns {string|null}
 */
export function retentionAgeClause(cfg, days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n < 0) return null;
  const dateCol = String(cfg?.dateColumn || '');
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dateCol)) return null;
  const compare = String(cfg?.compare || '');
  if (compare === 'unix_ms') return `${dateCol} < (unixepoch() * 1000 - ${n} * 86400000)`;
  if (compare === 'unix') return `${dateCol} < unixepoch('now', '-${n} days')`;
  if (compare === 'unix_ns') {
    return `${dateCol} < (CAST(unixepoch('now', '-${n} days') AS INTEGER) * 1000000000)`;
  }
  if (compare === 'date_col') return `date(${dateCol}) < date('now', '-${n} days')`;
  return `${dateCol} < datetime('now', '-${n} days')`;
}

function retentionConditionIsSafe(cond) {
  const c = String(cond || '').trim();
  if (!c) return true;
  if (/[;]/.test(c)) return false;
  if (/--|\/\*|\*\//.test(c)) return false;
  if (/\b(attach|detach|pragma|vacuum)\b/i.test(c)) return false;
  if (c.length > 2000) return false;
  return true;
}

/** D1 policies sometimes store human-readable notes instead of SQL — never execute those. */
function shouldSkipNonSqlCondition(condition) {
  const c = String(condition || '').trim();
  if (!c) return false;
  if (c.includes('—')) return true;
  if (c.toUpperCase().includes('NEVER')) return true;
  if (c.length > 200) return true;
  return false;
}

/**
 * D1 fingerprints `DELETE FROM t WHERE … LIMIT n` as an unbounded
 * `id IN (SELECT id FROM t LIMIT n)`. Keep the age predicate on the inner scan.
 */
export function retentionBatchDeleteSql(table, ageClause, condClause = '') {
  const t = String(table || '');
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(t)) return null;
  const age = String(ageClause || '');
  if (!age) return null;
  const cond = String(condClause || '');
  return `DELETE FROM ${t} WHERE rowid IN (
    SELECT rowid FROM ${t}
    WHERE ${age}${cond}
    ORDER BY rowid
    LIMIT 500
  )`;
}

/**
 * Midnight cron: batch-delete old rows per data_retention_policies (LIMIT 500 × 40 batches per table).
 * Unknown table_name values are skipped. Optional policy.condition appended as AND (...); use D1 for e.g.
 * agent_messages: session_id NOT IN (SELECT id FROM agent_sessions WHERE status = 'active')
 */
export async function runRetentionPurge(env) {
  if (!env?.DB) return;
  let policies = [];
  try {
    const q = await env.DB.prepare(
      `SELECT * FROM data_retention_policies WHERE COALESCE(is_active, 1) = 1`
    ).all();
    policies = q.results || [];
  } catch (e) {
    console.warn('[cron] retention policies load', e?.message ?? e);
    await writeCronAuditLog(env, {
      event_type: 'retention_purge',
      message: 'Failed to load data_retention_policies',
      metadata: { error: String(e?.message || e) },
    });
    return;
  }
  let grandTotal = 0;
  let policiesRun = 0;
  let skippedInvalidCondition = 0;
  const tablesAffected = [];
  const perTable = [];
  for (const policy of policies) {
    const table = policy.table_name != null ? String(policy.table_name).trim() : '';
    if (ONE_AM_MANAGED_TABLES.has(table)) {
      perTable.push({ table, deleted: 0, skipped: 'one_am_pipeline' });
      continue;
    }
    const cfg = RETENTION_PURGE_TABLE_CONFIG[table];
    if (!cfg) {
      console.warn('[cron] retention skip unknown table:', table);
      continue;
    }
    const days = Number(policy.retention_days);
    if (!Number.isFinite(days) || days < 0) continue;
    const ageClause = retentionAgeClause(cfg, days);
    if (!ageClause) continue;
    let condClause = '';
    const rawCond = policy.condition != null ? String(policy.condition).trim() : '';
    if (rawCond) {
      if (shouldSkipNonSqlCondition(rawCond)) {
        skippedInvalidCondition += 1;
        console.warn('[cron] retention skip non-SQL condition for table:', table);
        perTable.push({ table, deleted: 0, skipped: 'non_sql_condition' });
        continue;
      }
      if (!retentionConditionIsSafe(rawCond)) {
        skippedInvalidCondition += 1;
        console.warn('[cron] retention skip unsafe condition for table:', table);
        perTable.push({ table, deleted: 0, skipped: 'unsafe_condition' });
        continue;
      }
      condClause = ` AND (${rawCond})`;
    }
    const delSql = retentionBatchDeleteSql(table, ageClause, condClause);
    if (!delSql) continue;
    let deleted = 0;
    policiesRun += 1;
    try {
      for (let i = 0; i < RETENTION_PURGE_MAX_BATCHES; i++) {
        const r = await env.DB.prepare(delSql).run();
        const n = Number(r.meta?.changes ?? r.changes ?? 0) || 0;
        deleted += n;
        if (n < 500) break;
      }
    } catch (e) {
      console.warn('[cron] retention DELETE', table, e?.message ?? e);
      perTable.push({ table, deleted: 0, error: String(e?.message || e) });
      continue;
    }
    grandTotal += deleted;
    if (deleted > 0 && !tablesAffected.includes(table)) tablesAffected.push(table);
    perTable.push({
      table,
      deleted,
      capped: deleted === RETENTION_PURGE_MAX_BATCHES * 500,
    });
    if (deleted === RETENTION_PURGE_MAX_BATCHES * 500) {
      console.log('[cron] retention hit batch cap on', table, '(more may remain until next cron)');
    }
    try {
      const rid = policy.id != null ? String(policy.id).trim() : '';
      if (rid) {
        await env.DB.prepare(
          `UPDATE data_retention_policies SET last_purged_at = datetime('now'), rows_purged_total = COALESCE(rows_purged_total, 0) + ? WHERE id = ?`
        ).bind(deleted, rid).run();
      } else {
        await env.DB.prepare(
          `UPDATE data_retention_policies SET last_purged_at = datetime('now'), rows_purged_total = COALESCE(rows_purged_total, 0) + ? WHERE table_name = ?`
        ).bind(deleted, table).run();
      }
    } catch (e) {
      console.warn('[cron] retention policy UPDATE', table, e?.message ?? e);
    }
  }
  await writeCronAuditLog(env, {
    event_type: 'retention_purge',
    message: `Retention purge completed: ${grandTotal} rows deleted (batch max 500 x ${RETENTION_PURGE_MAX_BATCHES} per table)`,
    metadata: {
      policies_run: policiesRun,
      total_rows_deleted: grandTotal,
      tables_affected: tablesAffected,
      skipped_invalid_condition: skippedInvalidCondition,
      per_table: perTable,
    },
  });

  return {
    rowsWritten: grandTotal,
    metadata: {
      policies_run: policiesRun,
      total_rows_deleted: grandTotal,
      tables_affected: tablesAffected,
      skipped_invalid_condition: skippedInvalidCondition,
      per_table: perTable,
    },
  };
}

async function writeCronAuditLog(env, { event_type, message, run_id = null, metadata = {} }) {
  if (!env?.DB) return;
  const tid = await resolveCronTenantId(env);
  if (!tid) return;
  try {
    const id = crypto.randomUUID();
    const slug = String(event_type || 'event').replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 60);
    const meta = JSON.stringify({ tenant_id: tid, run_id, ...metadata }).slice(0, 8000);
    const et = String(event_type || 'audit').slice(0, 200);
    const msg = String(message || '').slice(0, 4000);
    await env.DB.prepare(
      `INSERT INTO agentsam_hook_execution (
        id, hook_id, tenant_id, ran_at, status, event_type, message, metadata_json, run_id, created_at, error_message
      ) VALUES (?, ?, ?, unixepoch(), 'audit', ?, ?, ?, ?, unixepoch(), ?)`
    ).bind(id, `audit_${slug}`, tid, et, msg, meta, run_id ?? null, msg.slice(0, 500)).run();
  } catch (e) {
    console.warn('[writeCronAuditLog]', e?.message ?? e);
  }
}

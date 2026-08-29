/**
 * agentsam_error_log → agentsam_escalation + agentsam_health_daily.red_count
 * when error rates exceed thresholds (by error_type, tool, model).
 */


/** Rolling window for threshold counts (seconds). */
const WINDOW_SEC = 3600;

/** Minimum errors in window to trigger escalation + health red bump. */
const THRESHOLD_BY_ERROR_TYPE = 5;
const THRESHOLD_BY_TOOL = 3;
const THRESHOLD_BY_MODEL = 5;

/**
 * @param {string | null | undefined} raw
 */
function parseContextJson(raw) {
  if (raw == null || raw === '') return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
}

/**
 * @param {Record<string, unknown>} ctx
 */
function modelFromContext(ctx) {
  const keys = ['model_key', 'model', 'model_attempted', 'selected_model'];
  for (const k of keys) {
    const v = ctx[k];
    if (v != null && String(v).trim() !== '') return String(v).trim().slice(0, 200);
  }
  return null;
}

/**
 * @param {Record<string, unknown>} ctx
 */
function toolFromContext(ctx) {
  const keys = ['tool_name', 'tool_key', 'tool'];
  for (const k of keys) {
    const v = ctx[k];
    if (v != null && String(v).trim() !== '') return String(v).trim().slice(0, 200);
  }
  return null;
}

/**
 * @param {string} tenantId
 * @param {string} dimension
 * @param {string} value
 */
function breachRunGroupId(tenantId, dimension, value) {
  const safe = String(value).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
  return `err_thr_${String(tenantId).slice(0, 40)}_${dimension}_${safe}`.slice(0, 200);
}

/**
 * @param {any} env
 * @param {string} runGroupId
 * @param {number} sinceUnix
 */
async function escalationExistsForBreach(_env, _runGroupId, _sinceUnix) {
  // agentsam_escalation is a route/spawn decision ledger (migration 1123).
  // Error-threshold breaches no longer dedupe via that table.
  return false;
}

/**
 * @param {any} env
 * @param {{
 *   tenantId: string,
 *   workspaceId: string,
 *   errorLogId: string,
 *   errorType: string,
 *   errorMessage: string,
 *   sourceId?: string | null,
 *   modelKey?: string | null,
 *   breachDimension: string,
 *   breachValue: string,
 *   errorCount: number,
 *   threshold: number,
 * }} p
 */
async function insertEscalationFromErrorBreach(env, p) {
  // Migration 1123: agentsam_escalation is route/spawn/failover decisions only
  // (requires agent_run_id + mode + to_route_key). Error-volume breaches stay on
  // agentsam_health_daily / agentsam_error_log — do not INSERT here.
  void env;
  const runGroupId = breachRunGroupId(p.tenantId, p.breachDimension, p.breachValue);
  return {
    ok: true,
    skipped: true,
    reason: 'escalation_is_decision_ledger',
    runGroupId,
    errorLogId: p.errorLogId,
  };
}

/**
 * @param {any} env
 * @param {{ tenantId: string, workspaceId?: string | null, note?: string }} p
 */
async function incrementHealthDailyRed(env, p) {
  const tenantId = String(p.tenantId).trim();
  if (!tenantId) return { ok: false, skipped: true, reason: 'no_tenant' };

  const note = p.note != null ? String(p.note).slice(0, 500) : 'error_log_threshold_breach';
  const ws = p.workspaceId != null ? String(p.workspaceId).trim() : null;
  const nowUnix = Math.floor(Date.now() / 1000);

  const updates = [
    'red_count = COALESCE(agentsam_health_daily.red_count, 0) + 1',
    'snapshot_count = COALESCE(agentsam_health_daily.snapshot_count, 0) + 1',
    "health_status = 'red'",
    "worst_status = 'red'",
    'health_notes = excluded.health_notes',
    'rolled_up_at = excluded.rolled_up_at',
    'rolled_up_at_unix = excluded.rolled_up_at_unix',
    'workspace_id = COALESCE(excluded.workspace_id, agentsam_health_daily.workspace_id)',
  ];

  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_health_daily (
         id, tenant_id, day, health_status, snapshot_count, green_count,
         yellow_count, red_count, worst_status, health_notes, rolled_up_at,
         workspace_id, rolled_up_at_unix
       ) VALUES (?, ?, date('now'), 'red', 1, 0, 0, 1, 'red', ?, ?, ?, ?)
       ON CONFLICT(tenant_id, day) DO UPDATE SET ${updates.join(', ')}`,
    )
      .bind(
        `ahd_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
        tenantId,
        note,
        new Date().toISOString().slice(0, 19).replace('T', ' '),
        ws,
        nowUnix,
      )
      .run();
    return { ok: true };
  } catch (e) {
    console.warn('[error-log-escalation] health_daily', e?.message ?? e);
    return { ok: false, reason: String(e?.message || e) };
  }
}

/**
 * @param {any} env
 * @param {string} tenantId
 * @param {string} [workspaceId]
 * @param {number} sinceUnix
 * @param {'error_type'|'tool'|'model'} dimension
 * @param {string} value
 */
async function countRecentErrors(env, tenantId, workspaceId, sinceUnix, dimension, value) {
  const binds = [tenantId, sinceUnix, workspaceId];
  const wsClause = ' AND workspace_id = ?';

  let dimClause = '';
  if (dimension === 'error_type') {
    dimClause = ' AND error_type = ?';
    binds.push(value);
  } else if (dimension === 'tool') {
    dimClause = ` AND (
      json_extract(context_json, '$.tool_name') = ?
      OR json_extract(context_json, '$.tool_key') = ?
      OR json_extract(context_json, '$.tool') = ?
    )`;
    binds.push(value, value, value);
  } else if (dimension === 'model') {
    dimClause = ` AND (
      json_extract(context_json, '$.model_key') = ?
      OR json_extract(context_json, '$.model') = ?
      OR json_extract(context_json, '$.model_attempted') = ?
      OR json_extract(context_json, '$.selected_model') = ?
    )`;
    binds.push(value, value, value, value);
  }

  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM agentsam_error_log
       WHERE tenant_id = ? AND created_at >= ?${wsClause}${dimClause}
         AND COALESCE(resolved, 0) = 0`,
    )
      .bind(...binds)
      .first();
    return Number(row?.c ?? 0) || 0;
  } catch {
    return 0;
  }
}

/**
 * Evaluate thresholds for one error_log row; escalate + bump health when breached.
 * @param {any} env
 * @param {{
 *   id: string,
 *   tenant_id: string,
 *   workspace_id: string,
 *   error_type: string,
 *   error_message: string,
 *   source_id?: string | null,
 *   context_json?: string | null,
 * }} row
 */
export async function evaluateErrorLogThresholds(env, row) {
  if (!env?.DB || !row?.id) return { ok: false, reason: 'missing_db_or_id' };

  const tenantId = row.tenant_id != null ? String(row.tenant_id).trim() : '';
  const workspaceId = row.workspace_id != null ? String(row.workspace_id).trim() : '';
  if (!tenantId || !workspaceId) return { ok: false, reason: 'missing_tenant_workspace' };

  const sinceUnix = Math.floor(Date.now() / 1000) - WINDOW_SEC;
  const ctx = parseContextJson(row.context_json);
  const toolName = toolFromContext(ctx);
  const modelKey = modelFromContext(ctx);
  const errorType = String(row.error_type || 'unknown').trim();

  /** @type {{ dimension: 'error_type'|'tool'|'model', value: string, threshold: number }[]} */
  const checks = [{ dimension: 'error_type', value: errorType, threshold: THRESHOLD_BY_ERROR_TYPE }];
  if (toolName) checks.push({ dimension: 'tool', value: toolName, threshold: THRESHOLD_BY_TOOL });
  if (modelKey) checks.push({ dimension: 'model', value: modelKey, threshold: THRESHOLD_BY_MODEL });

  const outcomes = [];
  let healthBumped = false;

  for (const { dimension, value, threshold } of checks) {
    const count = await countRecentErrors(env, tenantId, workspaceId, sinceUnix, dimension, value);
    if (count < threshold) continue;

    const esc = await insertEscalationFromErrorBreach(env, {
      tenantId,
      workspaceId,
      errorLogId: String(row.id),
      errorType,
      errorMessage: row.error_message,
      sourceId: row.source_id,
      modelKey,
      breachDimension: dimension,
      breachValue: value,
      errorCount: count,
      threshold,
    });
    if (esc.skipped && esc.reason === 'deduped') {
      outcomes.push({ dimension, value, count, escalated: false, deduped: true });
      continue;
    }

    let healthOk = false;
    if (!healthBumped) {
      const health = await incrementHealthDailyRed(env, {
        tenantId,
        workspaceId,
        note: `error_log ${dimension}=${value} count=${count}>=${threshold} (error ${row.id})`,
      });
      healthOk = !!health.ok;
      healthBumped = healthOk;
    }

    outcomes.push({
      dimension,
      value,
      count,
      threshold,
      escalated: !!esc.inserted || esc.ok,
      health: healthOk,
    });
  }

  return { ok: true, outcomes };
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {Parameters<typeof evaluateErrorLogThresholds>[1]} row
 */
export function scheduleErrorLogEscalation(env, ctx, row) {
  if (!env?.DB || !ctx?.waitUntil || !row?.id) return;
  ctx.waitUntil(evaluateErrorLogThresholds(env, row).catch((e) => {
    console.warn('[error-log-escalation]', e?.message ?? e);
  }));
}

/**
 * Hourly sweep: find dimension groups already at/above threshold without a recent breach escalation.
 * @param {any} env
 * @param {{ windowSec?: number }} [opts]
 */
export async function scanErrorLogThresholds(env, opts = {}) {
  if (!env?.DB) return { ok: false, skipped: true, reason: 'no_db' };

  const windowSec = Math.max(300, Number(opts.windowSec) || WINDOW_SEC);
  const sinceUnix = Math.floor(Date.now() / 1000) - windowSec;

  let escalations = 0;
  let healthBumps = 0;

  const typeGroups = await env.DB.prepare(
    `SELECT tenant_id, workspace_id, error_type, COUNT(*) AS c,
            MAX(id) AS latest_id
     FROM agentsam_error_log
     WHERE created_at >= ?
       AND COALESCE(resolved, 0) = 0
     GROUP BY tenant_id, workspace_id, error_type
     HAVING c >= ?`,
  )
    .bind(sinceUnix, THRESHOLD_BY_ERROR_TYPE)
    .all()
    .catch(() => ({ results: [] }));

  for (const g of typeGroups.results || []) {
    const latest = await env.DB.prepare(
      `SELECT id, tenant_id, workspace_id, error_type, error_message, source_id, context_json
       FROM agentsam_error_log WHERE id = ? LIMIT 1`,
    )
      .bind(g.latest_id)
      .first()
      .catch(() => null);
    if (!latest) continue;
    const out = await evaluateErrorLogThresholds(env, latest);
    for (const o of out.outcomes || []) {
      if (o.escalated) escalations += 1;
      if (o.health) healthBumps += 1;
    }
  }

  if (errCols.has('context_json')) {
    const toolGroups = await env.DB.prepare(
      `SELECT tenant_id, workspace_id, tool_name, COUNT(*) AS c, MAX(id) AS latest_id
       FROM (
         SELECT tenant_id, workspace_id, id,
           COALESCE(
             json_extract(context_json, '$.tool_name'),
             json_extract(context_json, '$.tool_key'),
             json_extract(context_json, '$.tool')
           ) AS tool_name
         FROM agentsam_error_log
         WHERE created_at >= ?${resolvedClause}
       )
       WHERE tool_name IS NOT NULL AND trim(tool_name) != ''
       GROUP BY tenant_id, workspace_id, tool_name
       HAVING c >= ?`,
    )
      .bind(sinceUnix, THRESHOLD_BY_TOOL)
      .all()
      .catch(() => ({ results: [] }));

    for (const g of toolGroups.results || []) {
      const latest = await env.DB.prepare(
        `SELECT id, tenant_id, workspace_id, error_type, error_message, source_id, context_json
         FROM agentsam_error_log WHERE id = ? LIMIT 1`,
      )
        .bind(g.latest_id)
        .first()
        .catch(() => null);
      if (!latest) continue;
      const out = await evaluateErrorLogThresholds(env, latest);
      for (const o of out.outcomes || []) {
        if (o.escalated) escalations += 1;
        if (o.health) healthBumps += 1;
      }
    }

    const modelGroups = await env.DB.prepare(
      `SELECT tenant_id, workspace_id, model_key, COUNT(*) AS c, MAX(id) AS latest_id
       FROM (
         SELECT tenant_id, workspace_id, id,
           COALESCE(
             json_extract(context_json, '$.model_key'),
             json_extract(context_json, '$.model'),
             json_extract(context_json, '$.model_attempted'),
             json_extract(context_json, '$.selected_model')
           ) AS model_key
         FROM agentsam_error_log
         WHERE created_at >= ?${resolvedClause}
       )
       WHERE model_key IS NOT NULL AND trim(model_key) != ''
       GROUP BY tenant_id, workspace_id, model_key
       HAVING c >= ?`,
    )
      .bind(sinceUnix, THRESHOLD_BY_MODEL)
      .all()
      .catch(() => ({ results: [] }));

    for (const g of modelGroups.results || []) {
      const latest = await env.DB.prepare(
        `SELECT id, tenant_id, workspace_id, error_type, error_message, source_id, context_json
         FROM agentsam_error_log WHERE id = ? LIMIT 1`,
      )
        .bind(g.latest_id)
        .first()
        .catch(() => null);
      if (!latest) continue;
      const out = await evaluateErrorLogThresholds(env, latest);
      for (const o of out.outcomes || []) {
        if (o.escalated) escalations += 1;
        if (o.health) healthBumps += 1;
      }
    }
  }

  return { ok: true, escalations, healthBumps, windowSec };
}

import { runHyperdriveQuery, isHyperdriveUsable } from '../../../../backend/services/database/hyperdrive.js';

function pgQuoteIdent(ident) {
  const s = String(ident || '').trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) {
    throw new Error('invalid table or column identifier');
  }
  return `"${s.replace(/"/g, '""')}"`;
}

async function pgHasColumn(env, tableName, colName) {
  if (!isHyperdriveUsable(env)) return false;
  try {
    const r = await runHyperdriveQuery(
      env,
      `SELECT 1 AS ok
       FROM information_schema.columns
       WHERE table_schema = 'agentsam' AND table_name = $1 AND column_name = $2
       LIMIT 1`,
      [tableName, colName],
    );
    return r.ok && (r.rows || []).length > 0;
  } catch {
    return false;
  }
}

/**
 * Run arbitrary read-only SQL against Supabase via Hyperdrive.
 * @returns {{ ok: boolean, rows: any[], warning?: string }}
 */
export async function supabaseQuery(env, sql, params = []) {
  if (!isHyperdriveUsable(env)) {
    return { ok: false, rows: [], warning: 'hyperdrive_missing' };
  }
  const r = await runHyperdriveQuery(env, sql, params);
  if (!r.ok) {
    return { ok: false, rows: [], warning: r.error || 'query_failed' };
  }
  return { ok: true, rows: r.rows ?? [] };
}

function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(v || '').trim(),
  );
}

export async function supabaseCountLatest(
  env,
  tableName,
  { tenantId = null, workspaceId = null, range = null } = {},
) {
  if (!isHyperdriveUsable(env)) {
    return { ok: false, count: 0, latest: null, time_col: null, has_tenant: false, warning: 'hyperdrive_missing' };
  }

  const safeTable = String(tableName).trim();
  let ident;
  try {
    ident = pgQuoteIdent(safeTable);
  } catch {
    return { ok: false, count: 0, latest: null, time_col: null, has_tenant: false, warning: 'invalid_table' };
  }

  const hasTenant = await pgHasColumn(env, safeTable, 'tenant_id');
  const hasWorkspace = await pgHasColumn(env, safeTable, 'workspace_id');
  const timeCandidates = ['created_at', 'started_at', 'updated_at', 'captured_at', 'checked_at', 'forecast_date'];
  let timeCol = null;
  for (const c of timeCandidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await pgHasColumn(env, safeTable, c)) {
      timeCol = c;
      break;
    }
  }

  const where = [];
  const params = [];
  // Prefer workspace_id (agentsam cutover) when the session carries a UUID.
  if (hasWorkspace && workspaceId && isUuid(workspaceId)) {
    params.push(String(workspaceId).trim());
    where.push(`workspace_id = $${params.length}::uuid`);
  } else if (hasTenant && tenantId) {
    params.push(String(tenantId));
    where.push(`tenant_id = $${params.length}`);
  }
  if (range && timeCol) {
    if (range === '24h') where.push(`${pgQuoteIdent(timeCol)} >= now() - interval '24 hours'`);
    if (range === '7d') where.push(`${pgQuoteIdent(timeCol)} >= now() - interval '7 days'`);
    if (range === '30d') where.push(`${pgQuoteIdent(timeCol)} >= now() - interval '30 days'`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const scoped = hasTenant || hasWorkspace;

  try {
    const countR = await runHyperdriveQuery(
      env,
      `SELECT COUNT(*)::int AS c FROM agentsam.${ident} ${whereSql}`,
      params,
    );
    if (!countR.ok) {
      return {
        ok: false,
        count: 0,
        latest: null,
        time_col: timeCol,
        has_tenant: scoped,
        warning: countR.error || 'query_failed',
      };
    }
    const count = Number(countR.rows?.[0]?.c ?? 0) || 0;
    let latest = null;
    if (timeCol) {
      const latestR = await runHyperdriveQuery(
        env,
        `SELECT MAX(${pgQuoteIdent(timeCol)}) AS latest FROM agentsam.${ident} ${whereSql}`,
        params,
      );
      if (latestR.ok) latest = latestR.rows?.[0]?.latest ?? null;
    }
    return { ok: true, count, latest, time_col: timeCol, has_tenant: scoped };
  } catch (e) {
    return {
      ok: false,
      count: 0,
      latest: null,
      time_col: timeCol,
      has_tenant: scoped,
      warning: e?.message ? String(e.message) : 'query_failed',
    };
  }
}

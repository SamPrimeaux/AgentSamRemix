/**
 * /api/hyperdrive/* — Postgres Database Studio for the authenticated user.
 *
 * Identity resolves per session: OAuth Supabase Management API + workspace project pin.
 * env.HYPERDRIVE (worker binding) is app-internal only — never used for human sessions.
 * Other users only see Postgres when they connect their own Supabase/Cloudflare account.
 */
import { jsonResponse } from '../core/responses.js';
import { getAuthUser } from '../core/auth.js';
import { getDatabaseSqlRunGate } from '../core/database-sql-safety.js';
import {
  buildAllowlistedOrderBy,
  buildPostgresFilterWhere,
  parseDatabaseFiltersJson,
} from '../core/database-table-filters.js';
import { dispatchCustomerSupabase } from '../core/customer-supabase-dispatch.js';
import { resolveEffectiveWorkspaceId } from '../../backend/identity/bootstrap.js';
import { getUserSupabaseToken } from '../../backend/identity/oauth/user-token.js';

/** Dashboard UI label for default workspace Postgres — not env.HYPERDRIVE. */
const WORKSPACE_DEFAULT_RESOURCE = 'platform_supabase';

/** @param {string} ident */
function pgQuoteIdent(ident) {
  const s = String(ident || '').trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) {
    throw new Error('invalid table or column identifier');
  }
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * @param {string} tableRaw
 * @param {string|null} [schemaParam]
 */
function parseHyperdriveTableRef(tableRaw, schemaParam = null) {
  const raw = String(tableRaw || '').trim();
  const schemaFromQuery = schemaParam != null ? String(schemaParam).trim() : '';
  if (raw.includes('.')) {
    const [schema, table] = raw.split('.', 2);
    return { schema: schema.trim(), table: table.trim() };
  }
  if (schemaFromQuery) {
    return { schema: schemaFromQuery, table: raw };
  }
  return { schema: '', table: raw };
}

/** @param {string} schema @param {string} table */
function qualifiedTableSql(schema, table) {
  return `${pgQuoteIdent(schema)}.${pgQuoteIdent(table)}`;
}

/** Management SQL API is text-only — inline positional params after validation. */
function bindSqlParams(sql, params = []) {
  let out = String(sql || '');
  for (let i = params.length; i >= 1; i -= 1) {
    const v = params[i - 1];
    const lit =
      v == null
        ? 'NULL'
        : typeof v === 'number' && Number.isFinite(v)
          ? String(v)
          : `'${String(v).replace(/'/g, "''")}'`;
    out = out.replace(new RegExp(`\\$${i}\\b`, 'g'), lit);
  }
  return out;
}

/**
 * @param {any} env
 * @param {Request} request
 * @param {Record<string, unknown>} authUser
 * @param {URL} [url]
 * @param {Record<string, unknown>} [body]
 */
async function resolveHyperdriveStudioScope(env, request, authUser, url = null, body = {}) {
  const userId = String(authUser?.id || '').trim();
  if (!userId) {
    return { error: 'Unauthorized', status: 401, payload: { error: 'Unauthorized' } };
  }

  const wsRes = await resolveEffectiveWorkspaceId(env, request, authUser, {});
  const workspaceId = wsRes?.workspaceId ? String(wsRes.workspaceId).trim() : '';

  const tok = await getUserSupabaseToken(env, userId, workspaceId || null);
  if (!tok?.access_token) {
    return {
      error: 'supabase_not_connected',
      status: 403,
      payload: {
        error: 'supabase_not_connected',
        onboarding_required: true,
        message: 'Connect Supabase in Integrations to use Database Studio.',
        provider_options: ['d1', 'supabase'],
        active_provider: null,
      },
    };
  }

  const resourceRef = String(
    body?.resource_ref ?? body?.resourceRef ?? url?.searchParams?.get('resource_ref') ?? '',
  ).trim();
  let projectRef = String(
    body?.project_ref ?? body?.projectRef ?? url?.searchParams?.get('project_ref') ?? '',
  ).trim();
  if (!projectRef && resourceRef && resourceRef !== WORKSPACE_DEFAULT_RESOURCE) {
    projectRef = resourceRef;
  }
  // resource_ref=platform_supabase → workspace-pinned Supabase project (resolveProjectRef in dispatch).

  return {
    userId,
    workspaceId,
    projectRef: projectRef || null,
    authUser,
    tenantId: authUser?.tenant_id != null ? String(authUser.tenant_id) : null,
  };
}

/**
 * @param {any} env
 * @param {Awaited<ReturnType<typeof resolveHyperdriveStudioScope>>} scope
 * @param {string} sql
 * @param {{ params?: unknown[], write?: boolean, approval_id?: string|null, schema?: string|null }} [opts]
 */
async function runCustomerStudioSql(env, scope, sql, opts = {}) {
  if (scope.error) {
    return { ok: false, rows: [], error: scope.error, user_message: scope.payload?.message };
  }
  const boundSql = bindSqlParams(sql, opts.params || []);
  const operation = opts.write ? 'run_write_sql' : 'run_readonly_sql';
  const out = await dispatchCustomerSupabase(env, {
    operation,
    user_id: scope.userId,
    tenant_id: scope.tenantId,
    workspace_id: scope.workspaceId,
    project_ref: scope.projectRef,
    sql: boundSql,
    authUser: scope.authUser,
    approval_id: opts.approval_id ?? null,
    schema: opts.schema ?? null,
  });
  if (!out.ok) {
    return {
      ok: false,
      rows: [],
      error: out.error || out.reason || 'query_failed',
      user_message: out.user_message,
      requires_approval: out.requires_approval,
      out,
    };
  }
  return { ok: true, rows: out.rows ?? [], meta: { duration_ms: out.duration_ms } };
}

/**
 * POST body SQL — user's connected Supabase project (OAuth Management API).
 */
async function executeHyperdriveSqlFromRequest(request, env) {
  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const url = new URL(request.url);
  const scope = await resolveHyperdriveStudioScope(env, request, authUser, url, body);
  if (scope.error) return jsonResponse(scope.payload, scope.status);

  const sql = body?.sql;
  const params = Array.isArray(body?.params) ? body.params : [];
  if (!sql || typeof sql !== 'string') return jsonResponse({ error: 'SQL query required' }, 400);

  const trimmed = sql.trim();
  if (/^\s*DROP\s+DATABASE\b/i.test(trimmed)) {
    return jsonResponse({ error: 'DROP DATABASE is not permitted via this API' }, 403);
  }

  const gate = getDatabaseSqlRunGate(trimmed, {
    canWrite: false,
    studioApproved: body?.studio_approved === true || body?.studioApproved === true,
    destructiveConfirmed:
      body?.destructive_confirmed === true || body?.destructiveConfirmed === true,
  });
  if (!gate.canExecute) {
    return jsonResponse(
      {
        error: gate.error || 'SQL not permitted',
        code: gate.requiresConfirmTyping ? 'hyperdrive_destructive_confirm' : 'hyperdrive_read_only',
        statement_kind: gate.kind,
        risk_level: gate.riskLevel,
        requires_studio_approval: gate.requiresApproval === true && !gate.requiresConfirmTyping,
        requires_destructive_confirm: gate.requiresConfirmTyping === true,
      },
      gate.kind === 'unknown' ? 400 : 403,
    );
  }

  const isRead = gate.kind === 'read' || gate.kind === 'explain';
  if (!isRead) {
    const written = await dispatchCustomerSupabase(env, {
      operation: 'run_write_sql',
      user_id: scope.userId,
      tenant_id: scope.tenantId,
      workspace_id: scope.workspaceId,
      project_ref: scope.projectRef,
      sql: bindSqlParams(trimmed, params),
      authUser: scope.authUser,
      approval_id: body?.approval_id ?? body?.approvalId ?? null,
      agent_run_id: body?.agent_run_id ?? body?.agentRunId ?? null,
      schema: body?.schema != null ? String(body.schema).trim() : null,
    });
    return jsonResponse(written, written.ok ? 200 : written.requires_approval ? 403 : 400);
  }

  const t0 = Date.now();
  const result = await runCustomerStudioSql(env, scope, trimmed, { params });
  const executionMs = Date.now() - t0;
  if (!result.ok) {
    const detail = result.error ?? 'unknown';
    return jsonResponse(
      {
        error: detail,
        message: result.user_message || detail,
        detail,
        results: [],
        rows: [],
        requires_approval: result.requires_approval,
      },
      result.requires_approval ? 403 : 500,
    );
  }
  const rows = result.rows ?? [];
  return jsonResponse({
    ok: true,
    success: true,
    rows,
    results: rows,
    meta: result.meta ?? {
      duration_ms: executionMs,
      rows_read: rows.length,
    },
    executionMs,
    data_plane: 'customer_supabase',
  });
}

/** Hyperdrive SQL Execution Proxy (POST /api/hyperdrive). */
export async function handleHyperdriveApi(request, env) {
  return executeHyperdriveSqlFromRequest(request, env);
}

/**
 * Routes for /api/hyperdrive/* — caller's connected Supabase project (OAuth identity lane).
 */
export async function handleHyperdriveRoutes(request, url, env) {
  const pathLower = url.pathname.toLowerCase();
  const method = request.method.toUpperCase();

  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

  const scope = await resolveHyperdriveStudioScope(env, request, authUser, url);
  if (scope.error) return jsonResponse(scope.payload, scope.status);

  if (pathLower === '/api/hyperdrive' && method === 'POST') {
    return handleHyperdriveApi(request, env);
  }

  if (pathLower === '/api/hyperdrive/query' && method === 'POST') {
    return executeHyperdriveSqlFromRequest(request, env);
  }

  if ((pathLower === '/api/hyperdrive/health' || pathLower === '/api/hyperdrive/status') && method === 'GET') {
    const ping = await runCustomerStudioSql(
      env,
      scope,
      'SELECT 1 AS ok',
    );
    if (!ping.ok) {
      return jsonResponse(
        { ok: false, error: ping.error ?? 'query_failed', user_message: ping.user_message },
        503,
      );
    }
    return jsonResponse({
      ok: true,
      latency_ms: ping.meta?.duration_ms ?? null,
      active_connections: null,
      data_plane: 'customer_supabase',
      project_ref: scope.projectRef,
    });
  }

  if (pathLower === '/api/hyperdrive/tables' && method === 'GET') {
    const schemaFilter = url.searchParams.get('schema');
    const cacheKey = `hyperdrive_tables:v2:${scope.userId}:${scope.workspaceId}:${scope.projectRef || 'default'}:${schemaFilter || 'all'}`;
    const kv = env?.SESSION_CACHE || env?.KV || null;
    if (kv) {
      try {
        const raw = await kv.get(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.cachedAt && Date.now() - parsed.cachedAt < 60_000 && parsed.body) {
            return jsonResponse(parsed.body);
          }
        }
      } catch {
        /* ignore */
      }
    }
    const schemas = schemaFilter ? [schemaFilter] : ['pg_catalog', 'information_schema'];
    const placeholders = schemas.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `SELECT table_schema, table_name, table_type
      FROM information_schema.tables
      WHERE table_schema ${schemaFilter ? 'IN' : 'NOT IN'} (${placeholders})
        AND table_type = 'BASE TABLE'
      ORDER BY table_schema, table_name`;
    try {
      const result = await runCustomerStudioSql(env, scope, sql, { params: schemas });
      if (!result.ok) throw new Error(result.error || 'query_failed');
      const rows = result.rows ?? [];
      const tables = rows
        .map((r) => {
          const tableSchema = String(r.table_schema || '').trim();
          const tableName = String(r.table_name || '').trim();
          return {
            name: tableName,
            table_name: tableName,
            table_schema: tableSchema,
            qualified_name: `${tableSchema}.${tableName}`,
            table_type: r.table_type ?? null,
          };
        })
        .filter((r) => r.name);
      const body = { tables, default_schema: null, project_wide: !schemaFilter, data_plane: 'customer_supabase' };
      if (kv) {
        kv.put(cacheKey, JSON.stringify({ cachedAt: Date.now(), body }), { expirationTtl: 90 }).catch(() => {});
      }
      return jsonResponse(body);
    } catch (e) {
      return jsonResponse({
        tables: [],
        error: e?.message ?? String(e),
        hint: 'Check Supabase OAuth connection and workspace project pin',
      }, 200);
    }
  }

  const tableRoute = url.pathname.match(/^\/api\/hyperdrive\/table\/([^/]+)\/(schema|data)$/i);
  if (tableRoute && method === 'GET') {
    const tableRaw = decodeURIComponent(tableRoute[1]);
    const { schema: tableSchema, table: tableName } = parseHyperdriveTableRef(
      tableRaw,
      url.searchParams.get('schema'),
    );
    try {
      pgQuoteIdent(tableName);
      pgQuoteIdent(tableSchema);
    } catch {
      return jsonResponse({ error: 'Invalid table name' }, 400);
    }
    const action = tableRoute[2].toLowerCase();

    if (action === 'schema') {
      try {
        const schemaSql = `SELECT c.ordinal_position - 1 AS cid,
                  c.column_name AS name,
                  c.data_type AS type,
                  CASE WHEN c.is_nullable = 'NO' THEN 1 ELSE 0 END AS notnull,
                  c.column_default AS dflt_value,
                  CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END AS pk
             FROM information_schema.columns c
             LEFT JOIN (
               SELECT kcu.column_name
                 FROM information_schema.table_constraints tc
                 JOIN information_schema.key_column_usage kcu
                   ON kcu.constraint_name = tc.constraint_name
                  AND kcu.table_schema = tc.table_schema
                WHERE tc.table_schema = $1
                  AND tc.table_name = $2
                  AND tc.constraint_type = 'PRIMARY KEY'
             ) pk ON pk.column_name = c.column_name
            WHERE c.table_schema = $1
              AND c.table_name = $2
            ORDER BY c.ordinal_position`;
        const colsR = await runCustomerStudioSql(env, scope, schemaSql, {
          params: [tableSchema, tableName],
        });
        if (!colsR.ok) throw new Error(colsR.error || 'schema_columns_failed');
        const idxR = await runCustomerStudioSql(
          env,
          scope,
          `SELECT indexname AS name, indexdef AS sql
             FROM pg_indexes
            WHERE schemaname = $1 AND tablename = $2
            ORDER BY indexname`,
          { params: [tableSchema, tableName] },
        );
        if (!idxR.ok) throw new Error(idxR.error || 'schema_indexes_failed');
        const fkR = await runCustomerStudioSql(
          env,
          scope,
          `SELECT kcu.column_name AS source_column,
                  ccu.table_name AS target_table,
                  ccu.column_name AS target_column,
                  'outbound' AS direction
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
             JOIN information_schema.constraint_column_usage ccu
               ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = $1
              AND tc.table_name = $2`,
          { params: [tableSchema, tableName] },
        );
        if (!fkR.ok) throw new Error(fkR.error || 'schema_fk_failed');
        return jsonResponse({
          columns: colsR.rows ?? [],
          indexes: idxR.rows ?? [],
          foreign_keys: fkR.rows ?? [],
        });
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }

    const pageNum = Math.max(1, Number(url.searchParams.get('page') || '1'));
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || '50')));
    const sort = String(url.searchParams.get('sort') || '').trim();
    const dir = String(url.searchParams.get('dir') || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const tableRefSql = qualifiedTableSql(tableSchema, tableName);
    const filters = parseDatabaseFiltersJson(url.searchParams.get('filter'));

    const colsR = await runCustomerStudioSql(
      env,
      scope,
      `SELECT column_name AS name
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position`,
      { params: [tableSchema, tableName] },
    );
    if (!colsR.ok) throw new Error(colsR.error || 'schema_columns_failed');
    const columnAllowlist = new Set(
      (colsR.rows ?? []).map((r) => String(r.name || '').trim()).filter(Boolean),
    );

    let built = { where: '', values: [] };
    try {
      built = buildPostgresFilterWhere(filters, {
        quoteIdent: pgQuoteIdent,
        allowColumns: columnAllowlist,
      });
    } catch (filterErr) {
      return jsonResponse({ error: filterErr?.message || 'Invalid filter' }, 400);
    }

    let order = '';
    try {
      order = buildAllowlistedOrderBy(sort, dir, columnAllowlist, pgQuoteIdent);
    } catch {
      order = '';
    }

    const offset = (pageNum - 1) * limit;
    const filterValues = built.values;
    const limitParam = `$${filterValues.length + 1}`;
    const offsetParam = `$${filterValues.length + 2}`;
    try {
      const countRes = await runCustomerStudioSql(
        env,
        scope,
        `SELECT COUNT(*)::int AS count FROM ${tableRefSql}${built.where}`,
        { params: filterValues },
      );
      if (!countRes.ok) throw new Error(countRes.error || 'count_failed');
      const total = Number(countRes.rows?.[0]?.count ?? 0);
      const rowsRes = await runCustomerStudioSql(
        env,
        scope,
        `SELECT * FROM ${tableRefSql}${built.where}${order} LIMIT ${limitParam} OFFSET ${offsetParam}`,
        { params: [...filterValues, limit, offset] },
      );
      if (!rowsRes.ok) throw new Error(rowsRes.error || 'select_failed');
      const rowList = rowsRes.rows ?? [];
      return jsonResponse({
        rows: rowList,
        total_count: total,
        columns: rowList.length ? Object.keys(rowList[0]) : [],
        page: pageNum,
        total_pages: Math.max(1, Math.ceil(total / limit)),
      });
    } catch (e) {
      return jsonResponse({ error: e?.message ?? String(e) }, 500);
    }
  }

  return jsonResponse({ error: 'Hyperdrive route not found' }, 404);
}

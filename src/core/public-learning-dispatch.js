/**
 * public.iam_* read-only learning layer (Zone B — safe for all authenticated users).
 */
import { runHyperdriveQuery, isHyperdriveUsable } from '../../backend/services/database/hyperdrive.js';
import { evaluateDataPlaneOperation } from './database-operation-policy.js';
import { logCustomerDataPlaneEvent } from './customer-data-plane-telemetry.js';

const PUBLIC_IAM_TABLE_RE = /^iam_[a-z0-9_]+$/i;
const PUBLIC_SCHEMA = 'public';

/**
 * @param {string} table
 */
export function isPublicLearningTable(table) {
  return PUBLIC_IAM_TABLE_RE.test(String(table || '').trim());
}

/**
 * @param {any} env
 */
export async function publicLearningListTables(env) {
  if (!isHyperdriveUsable(env)) return { ok: false, tables: [], error: 'hyperdrive_unavailable' };
  const sql = `SELECT table_name
     FROM information_schema.tables
    WHERE table_schema = $1
      AND table_type = 'BASE TABLE'
      AND table_name LIKE 'iam_%'
    ORDER BY table_name`;
  const r = await runHyperdriveQuery(env, sql, [PUBLIC_SCHEMA]);
  if (!r.ok) return { ok: false, tables: [], error: r.error };
  const tables = (r.rows || []).map((row) => ({
    schema: PUBLIC_SCHEMA,
    name: String(row.table_name || ''),
    qualified_name: `${PUBLIC_SCHEMA}.${row.table_name}`,
  }));
  return { ok: true, tables };
}

/**
 * @param {any} env
 * @param {string} table
 */
export async function publicLearningDescribeTable(env, table) {
  const name = String(table || '').trim();
  if (!isPublicLearningTable(name)) {
    return { ok: false, error: 'table_not_in_public_learning_allowlist' };
  }
  const sql = `SELECT column_name, data_type, is_nullable, column_default, ordinal_position
     FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position`;
  const r = await runHyperdriveQuery(env, sql, [PUBLIC_SCHEMA, name]);
  return { ok: r.ok, columns: r.rows || [], error: r.error };
}

/**
 * @param {any} env
 * @param {string} table
 * @param {number} [limit]
 */
export async function publicLearningReadTable(env, table, limit = 25) {
  const name = String(table || '').trim();
  if (!isPublicLearningTable(name)) {
    return { ok: false, error: 'table_not_in_public_learning_allowlist' };
  }
  const lim = Math.min(Math.max(1, Number(limit) || 25), 100);
  const sql = `SELECT * FROM ${quoteIdent(PUBLIC_SCHEMA)}.${quoteIdent(name)} LIMIT $1`;
  const policy = evaluateDataPlaneOperation({
    owner_type: 'public_learning',
    operation_type: 'select',
    sql_class: 'read',
    is_owner: false,
    schema: PUBLIC_SCHEMA,
    table: name,
  });
  if (!policy.allowed) return { ok: false, error: policy.reason, policy };

  const r = await runHyperdriveQuery(env, sql, [lim]);
  return { ok: r.ok, rows: r.rows || [], error: r.error, policy };
}

/**
 * @param {any} env
 * @param {string} sql
 * @param {import('./database-operation-policy.js').DataPlanePolicyContext} planeCtx
 */
export async function publicLearningReadonlySql(env, sql, planeCtx = {}) {
  const trimmed = String(sql || '').trim();
  const policy = evaluateDataPlaneOperation({
    ...planeCtx,
    owner_type: 'public_learning',
    operation_type: 'run_readonly_sql',
    sql,
    schema: PUBLIC_SCHEMA,
  });
  if (!policy.allowed) return { ok: false, rows: [], error: policy.reason, policy };

  if (!/\bpublic\.iam_/i.test(trimmed) && !/\bfrom\s+iam_/i.test(trimmed)) {
    return { ok: false, error: 'public_learning_sql_must_target_iam_tables', policy };
  }

  const r = await runHyperdriveQuery(env, trimmed, []);
  return { ok: r.ok, rows: r.rows || [], error: r.error, policy };
}

/** @param {string} ident */
function quoteIdent(ident) {
  const s = String(ident || '').trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) throw new Error('invalid identifier');
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * @param {any} env
 * @param {{
 *   operation: string,
 *   table?: string,
 *   sql?: string,
 *   limit?: number,
 *   user_id?: string|null,
 *   tenant_id?: string|null,
 *   workspace_id?: string|null,
 *   agent_run_id?: string|null,
 * }} opts
 */
export async function dispatchPublicLearning(env, opts) {
  const t0 = Date.now();
  const operation = String(opts.operation || '').trim();

  /** @type {Record<string, () => Promise<Record<string, unknown>>>} */
  const handlers = {
    list_modules: async () => publicLearningListTables(env),
    list_examples: async () => publicLearningListTables(env),
    list_tables: async () => publicLearningListTables(env),
    read_table: async () => publicLearningReadTable(env, opts.table, opts.limit),
    describe_table: async () => publicLearningDescribeTable(env, opts.table),
    public_learning_read_table: async () => publicLearningReadTable(env, opts.table, opts.limit),
    public_learning_list_modules: async () => publicLearningListTables(env),
    run_readonly_sql: async () =>
      publicLearningReadonlySql(env, opts.sql, {
        user_id: opts.user_id,
        tenant_id: opts.tenant_id,
        workspace_id: opts.workspace_id,
      }),
    public_learning_search: async () => {
      const tables = await publicLearningListTables(env);
      if (!tables.ok) return tables;
      const q = String(opts.sql || opts.query || '').toLowerCase();
      const filtered = (tables.tables || []).filter((t) =>
        !q ? true : String(t.name).toLowerCase().includes(q) || String(t.qualified_name).toLowerCase().includes(q),
      );
      return { ok: true, tables: filtered };
    },
  };

  const handler = handlers[operation];
  if (!handler) {
    return { ok: false, operation, data_plane: 'public_learning', error: `unknown_operation:${operation}` };
  }

  try {
    const payload = await handler();
    const ok = payload.ok !== false;
    await logCustomerDataPlaneEvent(env, {
      user_id: opts.user_id,
      tenant_id: opts.tenant_id,
      workspace_id: opts.workspace_id,
      data_plane: 'public_learning',
      owner_type: 'public_learning',
      provider: 'public',
      operation_type: operation,
      success: ok,
      error_message: ok ? null : payload.error,
      duration_ms: Date.now() - t0,
      sql: opts.sql,
      agent_run_id: opts.agent_run_id,
    });
    return {
      ...payload,
      ok,
      operation,
      data_plane: 'public_learning',
      owner_type: 'public_learning',
      duration_ms: Date.now() - t0,
      read_only: true,
    };
  } catch (e) {
    await logCustomerDataPlaneEvent(env, {
      user_id: opts.user_id,
      tenant_id: opts.tenant_id,
      workspace_id: opts.workspace_id,
      data_plane: 'public_learning',
      operation_type: operation,
      success: false,
      error_message: e?.message ? String(e.message) : String(e),
      duration_ms: Date.now() - t0,
      agent_run_id: opts.agent_run_id,
    });
    return {
      ok: false,
      operation,
      data_plane: 'public_learning',
      error: e?.message ? String(e.message) : String(e),
      duration_ms: Date.now() - t0,
    };
  }
}

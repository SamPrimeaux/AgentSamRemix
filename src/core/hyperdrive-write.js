/**
 * Awaited Hyperdrive SQL writes for platform Postgres.
 * Catalog surface: agentsam_supabase_write (D1 agentsam_tools).
 * Fail loud — no waitUntil swallow, no default ON CONFLICT DO NOTHING.
 */
import { isHyperdriveUsable, runHyperdriveTransaction } from '../../backend/services/database/hyperdrive.js';
import { classifyDatabaseSqlStatement } from './database-sql-safety.js';

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const CRUD_OPS = new Set(['insert', 'update', 'delete']);

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {unknown} ident
 * @returns {{ ok: true, quoted: string, raw: string } | { ok: false, error: string }}
 */
export function quotePgIdent(ident) {
  const raw = trim(ident);
  if (!raw || !IDENT_RE.test(raw)) {
    return { ok: false, error: `invalid_identifier:${raw.slice(0, 48) || '(empty)'}` };
  }
  return { ok: true, quoted: `"${raw.replace(/"/g, '""')}"`, raw };
}

/**
 * @param {unknown} returning
 */
function returningClause(returning) {
  if (returning === false || returning == null || returning === '') return ' RETURNING *';
  const raw = trim(returning);
  if (raw === '*') return ' RETURNING *';
  const parts = raw.split(',').map((p) => quotePgIdent(p));
  const bad = parts.find((p) => !p.ok);
  if (bad && !bad.ok) return { ok: false, error: bad.error };
  return ` RETURNING ${parts.map((p) => p.quoted).join(', ')}`;
}

/**
 * @param {Record<string, unknown>} input
 * @returns {{ schema: string, table: string, qualified: string } | { ok: false, error: string }}
 */
function resolveTarget(input) {
  const schemaQ = quotePgIdent(input.schema != null && trim(input.schema) ? input.schema : 'agentsam');
  if (!schemaQ.ok) return schemaQ;
  const tableQ = quotePgIdent(input.table);
  if (!tableQ.ok) {
    return { ok: false, error: tableQ.error === 'invalid_identifier:(empty)' ? 'table_required' : tableQ.error };
  }
  return {
    ok: true,
    schema: schemaQ.raw,
    table: tableQ.raw,
    qualified: `${schemaQ.quoted}.${tableQ.quoted}`,
  };
}

function extraWhereParams(body) {
  if (Array.isArray(body.where_params)) return body.where_params;
  if (Array.isArray(body.whereParams)) return body.whereParams;
  if (typeof body.where === 'string' && Array.isArray(body.params)) return body.params;
  return [];
}

function compileWhere(where, startParams = []) {
  const params = startParams.slice();
  if (where == null || where === '') {
    return { ok: false, error: 'where_required' };
  }
  if (typeof where === 'string') {
    const sql = where.trim();
    if (!sql) return { ok: false, error: 'where_required' };
    if (!/\bWHERE\b/i.test(sql) && !/^(AND|OR)\b/i.test(sql)) {
      return { ok: true, sql: `WHERE ${sql}`, params };
    }
    if (/^\s*WHERE\b/i.test(sql)) return { ok: true, sql, params };
    return { ok: true, sql: `WHERE ${sql}`, params };
  }
  if (typeof where !== 'object' || Array.isArray(where)) {
    return { ok: false, error: 'where_invalid' };
  }
  const keys = Object.keys(where);
  if (!keys.length) return { ok: false, error: 'where_required' };
  const parts = [];
  for (const key of keys) {
    const col = quotePgIdent(key);
    if (!col.ok) return col;
    params.push(where[key]);
    parts.push(`${col.quoted} = $${params.length}`);
  }
  return { ok: true, sql: `WHERE ${parts.join(' AND ')}`, params };
}

function resolveInsertColumns(input) {
  if (input.row && typeof input.row === 'object' && !Array.isArray(input.row)) {
    const fields = Object.keys(input.row);
    return { fields, values: fields.map((k) => input.row[k]) };
  }
  const fields = Array.isArray(input.fields) ? input.fields.map((f) => trim(f)) : [];
  const values = Array.isArray(input.values) ? input.values : [];
  return { fields, values };
}

/**
 * Compile INSERT / UPDATE / DELETE / raw SQL. Does not execute.
 * @param {Record<string, unknown>} [input]
 * @returns {{ ok: true, sql: string, params: unknown[], operation: string } | { ok: false, error: string, user_message?: string }}
 */
export function compileAgentsamSqlWrite(input = {}) {
  const body = input && typeof input === 'object' ? input : {};
  const sqlRaw = trim(body.sql);
  let op = trim(body.operation || body.op).toLowerCase();
  if (op === 'create') op = 'insert';
  if (op === 'execute' || op === 'execute_sql' || op === 'write' || op === 'sql') op = 'sql';

  if (sqlRaw && (!op || op === 'sql' || !CRUD_OPS.has(op))) {
    return {
      ok: true,
      sql: sqlRaw,
      params: Array.isArray(body.params) ? body.params : [],
      operation: 'sql',
    };
  }

  if (!CRUD_OPS.has(op)) {
    return {
      ok: false,
      error: 'sql_or_crud_operation_required',
      user_message: 'Pass sql, or operation=insert|update|delete with table.',
    };
  }

  const target = resolveTarget(body);
  if (!target.ok) return target;

  const ret = returningClause(body.returning);
  if (typeof ret === 'object' && ret.ok === false) return ret;

  if (op === 'insert') {
    const { fields, values } = resolveInsertColumns(body);
    if (!fields.length || fields.length !== values.length) {
      return {
        ok: false,
        error: 'insert_fields_values_mismatch',
        user_message: 'INSERT requires row {} or fields[] + values[] of equal length.',
      };
    }
    const cols = [];
    for (const field of fields) {
      const q = quotePgIdent(field);
      if (!q.ok) return q;
      cols.push(q.quoted);
    }
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const onConflict = trim(body.on_conflict || body.onConflict);
    const conflictSql = onConflict ? ` ON CONFLICT ${onConflict}` : '';
    return {
      ok: true,
      sql: `INSERT INTO ${target.qualified} (${cols.join(', ')}) VALUES (${placeholders})${conflictSql}${ret}`,
      params: values,
      operation: 'insert',
    };
  }

  if (op === 'update') {
    const setObj =
      body.set && typeof body.set === 'object' && !Array.isArray(body.set)
        ? body.set
        : null;
    if (!setObj || !Object.keys(setObj).length) {
      return { ok: false, error: 'update_set_required', user_message: 'UPDATE requires set {}.' };
    }
    const setParts = [];
    const params = [];
    for (const key of Object.keys(setObj)) {
      const col = quotePgIdent(key);
      if (!col.ok) return col;
      params.push(setObj[key]);
      setParts.push(`${col.quoted} = $${params.length}`);
    }
    const where = compileWhere(body.where, params);
    if (!where.ok) {
      return { ok: false, error: where.error, user_message: 'UPDATE requires a WHERE clause or where {}.' };
    }
    const whereParams =
      typeof body.where === 'string' ? params.concat(extraWhereParams(body)) : where.params;
    return {
      ok: true,
      sql: `UPDATE ${target.qualified} SET ${setParts.join(', ')} ${where.sql}${ret}`,
      params: whereParams,
      operation: 'update',
    };
  }

  const where = compileWhere(
    body.where,
    typeof body.where === 'string' ? extraWhereParams(body) : [],
  );
  if (!where.ok) {
    return { ok: false, error: where.error, user_message: 'DELETE requires a WHERE clause or where {}.' };
  }
  return {
    ok: true,
    sql: `DELETE FROM ${target.qualified} ${where.sql}${ret}`,
    params: where.params,
    operation: 'delete',
  };
}

/**
 * Execute mutating SQL. Fail loud when Hyperdrive is down or the statement is not a write.
 * @param {any} env
 * @param {string} sql
 * @param {unknown[]} [params]
 */
export async function hyperdriveWriteSql(env, sql, params = []) {
  if (!isHyperdriveUsable(env)) {
    return { ok: false, rows: [], row_count: 0, error: 'hyperdrive_unavailable' };
  }
  const statement = trim(sql);
  if (!statement) {
    return { ok: false, rows: [], row_count: 0, error: 'sql_required' };
  }
  const kind = classifyDatabaseSqlStatement(statement);
  if (kind === 'read' || kind === 'explain' || kind === 'unknown') {
    return {
      ok: false,
      rows: [],
      row_count: 0,
      error: 'write_operation_required',
      statement_kind: kind,
    };
  }
  if (kind === 'mutation' && !/\bRETURNING\b/i.test(statement)) {
    return {
      ok: false,
      rows: [],
      row_count: 0,
      error: 'database_write_readback_required',
      statement_kind: kind,
      user_message: 'INSERT, UPDATE, and DELETE must include RETURNING for an auditable readback.',
    };
  }
  const tx = await runHyperdriveTransaction(env, async (client) => {
    const result = await client.query(statement, params);
    return {
      rows: result?.rows ?? [],
      row_count: Number(result?.rowCount ?? result?.meta?.changes ?? 0) || 0,
      command: result?.command ?? null,
    };
  });
  if (!tx.ok) {
    return {
      ok: false,
      rows: [],
      row_count: 0,
      error: tx.error || 'hyperdrive_write_failed',
      statement_kind: kind,
    };
  }
  return {
    ok: true,
    rows: tx.rows || [],
    row_count: Number(tx.result?.row_count ?? tx.rows?.length ?? 0) || 0,
    command: tx.result?.command ?? null,
    statement_kind: kind,
  };
}

/**
 * Compile + execute insert/update/delete/sql.
 * @param {any} env
 * @param {Record<string, unknown>} input
 */
export async function executeHyperdriveCrud(env, input = {}) {
  const compiled = compileAgentsamSqlWrite(input);
  if (!compiled.ok) return { ...compiled, rows: [], row_count: 0 };
  const written = await hyperdriveWriteSql(env, compiled.sql, compiled.params);
  return { ...written, operation: compiled.operation, sql: compiled.sql };
}

/**
 * @param {any} env
 * @param {string} table
 * @param {string[]} fields
 * @param {unknown[]} values
 * @param {{ schema?: string, returning?: string, onConflict?: string }} [opts]
 */
export async function hyperdriveInsert(env, table, fields, values, opts = {}) {
  return executeHyperdriveCrud(env, {
    operation: 'insert',
    schema: opts.schema,
    table,
    fields,
    values,
    returning: opts.returning,
    on_conflict: opts.onConflict ?? opts.on_conflict,
  });
}

/**
 * @param {any} env
 * @param {string} table
 * @param {Record<string, unknown>} set
 * @param {string|Record<string, unknown>} where
 * @param {{ schema?: string, returning?: string }} [opts]
 */
export async function hyperdriveUpdate(env, table, set, where, opts = {}) {
  return executeHyperdriveCrud(env, {
    operation: 'update',
    schema: opts.schema,
    table,
    set,
    where,
    returning: opts.returning,
  });
}

/**
 * @param {any} env
 * @param {string} table
 * @param {string|Record<string, unknown>} where
 * @param {{ schema?: string, returning?: string }} [opts]
 */
export async function hyperdriveDelete(env, table, where, opts = {}) {
  return executeHyperdriveCrud(env, {
    operation: 'delete',
    schema: opts.schema,
    table,
    where,
    returning: opts.returning,
  });
}

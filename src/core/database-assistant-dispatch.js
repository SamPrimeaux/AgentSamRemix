/**
 * Platform Supabase/Postgres assistant. Hyperdrive is transport only.
 */
import {
  runHyperdriveQuery,
  isHyperdriveUsable,
} from '../../backend/services/database/hyperdrive.js';
import { hyperdriveWriteSql } from './hyperdrive-write.js';
import {
  classifyDatabaseOperation,
  evaluateDatabaseOperation,
  resolveDatabaseRuntimeContext,
} from './database-operation-policy.js';
import { classifyDatabaseSqlStatement } from './database-sql-safety.js';
import { assertDataPlaneAccess, logDataPlaneSecurityEvent } from './data-plane-access-guard.js';
import { logCustomerDataPlaneEvent } from './customer-data-plane-telemetry.js';

const SYSTEM_SCHEMA_EXCLUDES = ['pg_catalog', 'information_schema'];

/** @param {string} ident */
function pgQuoteIdent(ident) {
  const s = String(ident || '').trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) throw new Error('invalid identifier');
  return `"${s.replace(/"/g, '""')}"`;
}

/** @param {string} schema @param {string} table */
export function qualifiedPgTable(schema, table) {
  return `${pgQuoteIdent(schema)}.${pgQuoteIdent(table)}`;
}

/**
 * @param {unknown} authUser
 * @param {Record<string, unknown>} [opts]
 */
export function resolveDbAssistantContext(authUser, opts = {}) {
  return resolveDatabaseRuntimeContext(authUser, {
    tenantId: opts.tenant_id ?? opts.tenantId,
    workspaceId: opts.workspace_id ?? opts.workspaceId,
    role: opts.role,
    canRunD1: opts.can_run_d1 !== false,
    canRunHyperdrive: opts.can_run_hyperdrive !== false,
  });
}

/**
 * @param {any} env
 * @param {string[]|null} schemas
 */
async function hyperdriveListTables(env, schemas = null) {
  if (!isHyperdriveUsable(env)) return { ok: false, tables: [], error: 'hyperdrive_unavailable' };
  const requested = Array.isArray(schemas)
    ? schemas.map((s) => String(s || '').trim()).filter(Boolean)
    : [];
  const params = requested.length ? requested : SYSTEM_SCHEMA_EXCLUDES;
  const placeholders = params.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `SELECT table_schema, table_name, table_type
     FROM information_schema.tables
    WHERE table_schema ${requested.length ? 'IN' : 'NOT IN'} (${placeholders})
      AND table_type = 'BASE TABLE'
    ORDER BY table_schema, table_name`;
  const r = await runHyperdriveQuery(env, sql, params);
  if (!r.ok) return { ok: false, tables: [], error: r.error || 'list_tables_failed' };
  const tables = (r.rows || []).map((row) => ({
    schema: String(row.table_schema || ''),
    name: String(row.table_name || ''),
    qualified_name: `${row.table_schema}.${row.table_name}`,
    table_type: row.table_type ?? null,
  }));
  return { ok: true, tables };
}

/**
 * @param {any} env
 * @param {string} schema
 * @param {string} table
 */
async function hyperdriveDescribeTable(env, schema, table) {
  const sql = `SELECT column_name, data_type, is_nullable, column_default, ordinal_position
     FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position`;
  const r = await runHyperdriveQuery(env, sql, [schema, table]);
  if (!r.ok) return { ok: false, columns: [], error: r.error };
  return { ok: true, columns: r.rows || [] };
}

/**
 * @param {any} env
 * @param {string} schema
 * @param {string} table
 */
async function hyperdriveInspectIndexes(env, schema, table) {
  const sql = `SELECT indexname, indexdef
     FROM pg_indexes
    WHERE schemaname = $1 AND tablename = $2
    ORDER BY indexname`;
  const r = await runHyperdriveQuery(env, sql, [schema, table]);
  if (!r.ok) return { ok: false, indexes: [], error: r.error };
  return { ok: true, indexes: r.rows || [] };
}

/**
 * @param {any} env
 * @param {string} schema
 * @param {string} table
 */
async function hyperdriveInspectRls(env, schema, table) {
  const sql = `SELECT pol.polname AS policy_name,
          pol.polcmd AS command,
          pol.polpermissive AS permissive,
          pg_get_expr(pol.polqual, pol.polrelid) AS using_expression,
          pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expression
     FROM pg_policy pol
     JOIN pg_class cls ON cls.oid = pol.polrelid
     JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
    WHERE nsp.nspname = $1 AND cls.relname = $2
    ORDER BY pol.polname`;
  const r = await runHyperdriveQuery(env, sql, [schema, table]);
  if (!r.ok) return { ok: false, policies: [], error: r.error };
  return { ok: true, policies: r.rows || [] };
}

/**
 * @param {any} env
 * @param {string} sql
 * @param {unknown[]} params
 * @param {import('./database-operation-policy.js').DatabaseRuntimeContext} ctx
 */
async function hyperdriveReadonlySql(env, sql, params, ctx) {
  const evalResult = evaluateDatabaseOperation(sql, ctx);
  if (!evalResult.allowed) {
    return { ok: false, rows: [], error: evalResult.reason, policy: evalResult };
  }
  const r = await runHyperdriveQuery(env, sql, params);
  if (!r.ok) return { ok: false, rows: [], error: r.error || 'query_failed', policy: evalResult };
  return { ok: true, rows: r.rows || [], policy: evalResult, statement_kind: classifyDatabaseSqlStatement(sql) };
}

/**
 * @param {string} migrationSql
 */
export function generateRollbackStub(migrationSql) {
  const lines = String(migrationSql || '')
    .split(';')
    .map((l) => l.trim())
    .filter(Boolean);
  const rollback = lines.map((line) => `-- rollback stub: review manually\n-- forward: ${line.slice(0, 120)}`);
  return `${rollback.join('\n')}\n-- TODO: author inverse DDL before apply`;
}

function normalizeSqlForApproval(sql) {
  return String(sql || '').trim().replace(/\s+/g, ' ');
}

function approvalInputMatchesSql(inputJson, sql) {
  if (!inputJson) return false;
  try {
    const envelope = typeof inputJson === 'string' ? JSON.parse(inputJson) : inputJson;
    let args = envelope?.filled_template ?? envelope?.tool_args ?? envelope;
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        return false;
      }
    }
    const approvedSql = args?.sql ?? args?.migration_sql ?? null;
    return normalizeSqlForApproval(approvedSql) === normalizeSqlForApproval(sql);
  } catch {
    return false;
  }
}

/**
 * Validate a live, identity-scoped, SQL-matching approval. A non-empty string
 * is never sufficient by itself.
 */
export async function verifyDatabaseApproval(env, approvalId, ctx, sql) {
  const id = String(approvalId || '').trim();
  if (!env?.DB || !id) {
    return { ok: false, error: 'database_write_approval_required' };
  }
  const row = await env.DB.prepare(
    `SELECT id, status, expires_at, user_id, tenant_id, workspace_id, tool_name, input_json
       FROM agentsam_approval_queue
      WHERE id = ? LIMIT 1`,
  )
    .bind(id)
    .first()
    .catch(() => null);
  if (!row || String(row.status || '').toLowerCase() !== 'approved') {
    return { ok: false, error: 'database_write_approval_not_approved' };
  }
  const expiresAt = Number(row.expires_at);
  if (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= Math.floor(Date.now() / 1000)) {
    return { ok: false, error: 'database_write_approval_expired' };
  }
  const identityChecks = [
    ['user_id', ctx.user_id],
    ['tenant_id', ctx.tenant_id],
    ['workspace_id', ctx.workspace_id],
  ];
  for (const [key, expected] of identityChecks) {
    const actual = row[key] != null ? String(row[key]).trim() : '';
    const wanted = expected != null ? String(expected).trim() : '';
    if (actual && wanted && actual !== wanted) {
      return { ok: false, error: `database_write_approval_${key}_mismatch` };
    }
  }
  const toolName = String(row.tool_name || '').trim();
  if (toolName && !['agentsam_supabase_write', 'database_apply_approved_migration'].includes(toolName)) {
    return { ok: false, error: 'database_write_approval_tool_mismatch' };
  }
  if (!approvalInputMatchesSql(row.input_json, sql)) {
    return { ok: false, error: 'database_write_approval_sql_mismatch' };
  }
  return { ok: true, row };
}

/**
 * @param {any} env
 * @param {{
 *   operation: string,
 *   authUser: unknown,
 *   tenant_id?: string,
 *   workspace_id?: string,
 *   schema?: string,
 *   table?: string,
 *   resource_ref?: string,
 *   sql?: string,
 *   params?: unknown[],
 *   migration_sql?: string,
 *   approval_id?: string,
 *   agent_run_id?: string,
 * }} opts
 */
export async function dispatchDatabaseAssistant(env, opts) {
  const t0 = Date.now();
  const operation = String(opts.operation || '').trim();
  const ctx = resolveDbAssistantContext(opts.authUser, opts);
  const schema = opts.schema != null ? String(opts.schema).trim() : '';
  const table = opts.table != null ? String(opts.table).trim() : '';

  const platformAccess = assertDataPlaneAccess(
    {
      is_owner: ctx.is_owner,
      user_id: ctx.user_id,
      tenant_id: ctx.tenant_id,
      workspace_id: ctx.workspace_id,
    },
    'platform_supabase',
    operation,
    { sql: opts.sql, migration_sql: opts.migration_sql },
  );
  if (!platformAccess.allowed) {
    logDataPlaneSecurityEvent('access_denied', {
      surface: 'dispatchDatabaseAssistant',
      reason: platformAccess.reason,
      operation,
      user_id: ctx.user_id,
    });
    return {
      ok: false,
      operation,
      backend: 'supabase',
      transport: 'hyperdrive',
      duration_ms: Date.now() - t0,
      error: platformAccess.error,
      reason: platformAccess.reason,
      user_message: platformAccess.user_message,
      degraded_reason: platformAccess.reason,
    };
  }

  if (String(opts.resource_ref || '').trim() !== 'platform_supabase') {
    return {
      ok: false,
      operation,
      backend: 'supabase',
      transport: 'hyperdrive',
      duration_ms: Date.now() - t0,
      error: 'explicit_platform_supabase_resource_required',
    };
  }

  /** @type {Record<string, () => Promise<Record<string, unknown>>>} */
  const handlers = {
    inspect_schema: async () => {
      const listed = await hyperdriveListTables(env, ctx.is_owner ? null : ['public']);
      return { ...listed, schema: null, project_wide: ctx.is_owner === true };
    },
    list_tables: async () => hyperdriveListTables(env, schema ? [schema] : null),
    describe_table: async () => {
      if (!table) throw new Error('table required');
      if (!schema) throw new Error('schema required for table inspection');
      return hyperdriveDescribeTable(env, schema, table);
    },
    describe_columns: async () => {
      if (!table) throw new Error('table required');
      if (!schema) throw new Error('schema required for table inspection');
      return hyperdriveDescribeTable(env, schema, table);
    },
    inspect_indexes: async () => {
      if (!table) throw new Error('table required');
      if (!schema) throw new Error('schema required for index inspection');
      return hyperdriveInspectIndexes(env, schema, table);
    },
    inspect_rls: async () => {
      if (!table) throw new Error('table required');
      if (!schema) throw new Error('schema required for RLS inspection');
      return hyperdriveInspectRls(env, schema, table);
    },
    inspect_functions: async () => {
      if (!schema) throw new Error('schema required for function inspection');
      const sql = `SELECT routine_name, routine_type, data_type
         FROM information_schema.routines
        WHERE routine_schema = $1
        ORDER BY routine_name`;
      const r = await runHyperdriveQuery(env, sql, [schema]);
      return { ok: r.ok, routines: r.rows || [], error: r.error };
    },
    run_readonly_sql: async () => {
      const sql = String(opts.sql || '').trim();
      if (!sql) throw new Error('sql required');
      if (!isHyperdriveUsable(env)) return { ok: false, error: 'hyperdrive_unavailable' };
      return hyperdriveReadonlySql(env, sql, Array.isArray(opts.params) ? opts.params : [], ctx);
    },
    run_write_sql: async () => {
      const sql = String(opts.sql || opts.migration_sql || '').trim();
      const approvalId = opts.approval_id != null ? String(opts.approval_id).trim() : '';
      const params = Array.isArray(opts.params) ? opts.params : [];
      if (!sql) throw new Error('sql required');
      if (!opts.resource_ref || String(opts.resource_ref).trim() !== 'platform_supabase') {
        return { ok: false, error: 'explicit_platform_supabase_resource_required' };
      }
      const statementKind = classifyDatabaseSqlStatement(sql);
      if (statementKind === 'read' || statementKind === 'explain' || statementKind === 'unknown') {
        return { ok: false, error: 'write_operation_required' };
      }
      const evalResult = evaluateDatabaseOperation(sql, ctx, {
        explicitApprovalId: approvalId || null,
        schema,
      });
      if (!evalResult.allowed) {
        return {
          ok: false,
          error: evalResult.reason,
          requires_approval: evalResult.requires_approval === true,
          protected_schema: evalResult.protected_schema ?? null,
        };
      }
      const approval = await verifyDatabaseApproval(env, approvalId, ctx, sql);
      if (!approval.ok) {
        return { ok: false, error: approval.error, requires_approval: true };
      }
      if (statementKind === 'mutation' && !/\bRETURNING\b/i.test(sql)) {
        return {
          ok: false,
          error: 'database_write_readback_required',
          user_message: 'INSERT, UPDATE, and DELETE must include RETURNING for an auditable readback.',
        };
      }
      const tx = await hyperdriveWriteSql(env, sql, params);
      const receiptId = `dbwr_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
      if (tx.ok) {
        await env.DB.prepare(
          `UPDATE agentsam_approval_queue
              SET status = 'consumed', decided_at = COALESCE(decided_at, unixepoch())
            WHERE id = ? AND status = 'approved'`,
        )
          .bind(approvalId)
          .run()
          .catch(() => null);
      }
      await logCustomerDataPlaneEvent(env, {
        user_id: ctx.user_id,
        tenant_id: ctx.tenant_id,
        workspace_id: ctx.workspace_id,
        data_plane: 'platform_supabase',
        owner_type: 'platform',
        provider: 'supabase',
        connection_id: 'HYPERDRIVE',
        operation_type: 'run_write_sql',
        sql_class: statementKind,
        approval_id: approvalId,
        success: tx.ok,
        error_message: tx.error ?? null,
        duration_ms: Date.now() - t0,
        sql,
        agent_run_id: opts.agent_run_id ?? null,
      });
      return {
        ok: tx.ok,
        rows: tx.rows || [],
        error: tx.error,
        statement_kind: statementKind,
        approval_id: approvalId,
        receipt: {
          id: receiptId,
          provider: 'supabase',
          resource_ref: 'platform_supabase',
          schema: schema || null,
          row_count: Number(tx.row_count ?? 0) || 0,
          command: tx.command ?? null,
          readback_rows: tx.rows || [],
        },
        refresh: { schema: statementKind === 'schema', data: statementKind !== 'schema' },
      };
    },
    execute_sql: async () => {
      const sql = String(opts.sql || '').trim();
      const statementKind = classifyDatabaseSqlStatement(sql);
      return statementKind === 'read' || statementKind === 'explain'
        ? handlers.run_readonly_sql()
        : handlers.run_write_sql();
    },
    explain_query: async () => {
      const sql = String(opts.sql || '').trim();
      if (!sql) throw new Error('sql required');
      const explainSql = sql.match(/^\s*explain\b/i) ? sql : `EXPLAIN ${sql}`;
      return hyperdriveReadonlySql(env, explainSql, [], ctx);
    },
    propose_migration: async () => {
      const migrationSql = String(opts.migration_sql || opts.sql || '').trim();
      if (!migrationSql) throw new Error('migration_sql required');
      return {
        ok: true,
        migration_sql: migrationSql,
        rollback_sql: generateRollbackStub(migrationSql),
        requires_approval: true,
        approval_required: true,
        applied: false,
      };
    },
    validate_migration: async () => {
      const migrationSql = String(opts.migration_sql || opts.sql || '').trim();
      const op = classifyDatabaseOperation(migrationSql);
      return {
        ok: op !== 'blocked',
        operation_class: op,
        statement_kind: classifyDatabaseSqlStatement(migrationSql),
      };
    },
    generate_rollback: async () => {
      const migrationSql = String(opts.migration_sql || opts.sql || '').trim();
      return { ok: true, rollback_sql: generateRollbackStub(migrationSql) };
    },
    database_apply_approved_migration: async () => handlers.run_write_sql(),
  };

  const handler = handlers[operation];
  if (!handler) {
    return {
      ok: false,
      operation,
      backend: 'supabase',
      transport: 'hyperdrive',
      duration_ms: Date.now() - t0,
      error: `unknown_operation:${operation}`,
    };
  }

  if (!isHyperdriveUsable(env) && operation !== 'propose_migration' && operation !== 'validate_migration') {
    return {
      ok: false,
      operation,
      backend: 'supabase',
      transport: 'hyperdrive',
      duration_ms: Date.now() - t0,
      error: 'hyperdrive_unavailable',
    };
  }

  try {
    const payload = await handler();
    return {
      ok: payload.ok !== false,
      operation,
      backend: 'supabase',
      transport: 'hyperdrive',
      schema,
      table: table || null,
      duration_ms: Date.now() - t0,
      read_only: ['run_readonly_sql', 'explain_query', 'inspect_schema', 'list_tables', 'describe_table'].includes(
        operation,
      ),
      approval_required: payload.requires_approval === true || payload.approval_required === true,
      ...payload,
    };
  } catch (e) {
    return {
      ok: false,
      operation,
      backend: 'supabase',
      transport: 'hyperdrive',
      schema,
      duration_ms: Date.now() - t0,
      error: e?.message ? String(e.message) : String(e),
    };
  }
}

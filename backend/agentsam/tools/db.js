/**
 * Tool: Database (D1 + Hyperdrive/Postgres)
 * Shared SQL safety: src/core/database-sql-safety.js
 */

import { d1_query as d1QueryCore } from '../../../src/core/d1.js';
import { assertD1ReadOnlySelect } from '../../../src/core/d1-read-validator.js';
import {
  gateD1WriteContracts,
  d1WriteContractBypassResponseFields,
} from '../../../src/core/d1-write-contract.js';
import { assertD1SqlNotPostgresOnly } from '../../../src/core/d1-postgres-table-guard.js';
import { evaluateDatabaseSqlSafety } from '../../../src/core/database-sql-safety.js';
import { isHyperdriveUsable, runHyperdriveQuery } from '../../services/database/hyperdrive.js';
import { recordMcpToolExecution } from '../../../src/core/mcp-tool-execution.js';
import { resolveCanonicalUserId } from '../../identity/users/index.js';

/** @param {any} _env @param {string | null | undefined} _user_id */
async function resolveIsPlatformOperator(_env, _user_id) {
  return false;
}

/** @param {string} ident */
function pgQuoteIdent(ident) {
  const s = String(ident || '').trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) {
    throw new Error('invalid table or column identifier');
  }
  return `"${s.replace(/"/g, '""')}"`;
}

async function logPolicyBlock(env, fields) {
  if (!env?.DB) return;
  const tenantId = fields.tenant_id != null ? String(fields.tenant_id) : 'system';
  let userId = fields.user_id ?? null;
  if (userId) {
    userId = await resolveCanonicalUserId(String(userId).trim(), env);
  }
  const sessionId = fields.session_id ?? null;
  const workspaceId = fields.workspace_id != null ? String(fields.workspace_id) : null;
  const sqlSnippet = String(fields.sql || '').slice(0, 2000);
  const err = String(fields.error || 'policy_block');
  const toolName = fields.tool_name || 'd1_query';
  const spine = {
    agent_run_id:
      fields.agent_run_id != null && String(fields.agent_run_id).trim() !== ''
        ? String(fields.agent_run_id).trim()
        : fields.agentRunId != null && String(fields.agentRunId).trim() !== ''
          ? String(fields.agentRunId).trim()
          : null,
    conversation_id:
      fields.conversation_id != null && String(fields.conversation_id).trim() !== ''
        ? String(fields.conversation_id).trim()
        : fields.conversationId != null && String(fields.conversationId).trim() !== ''
          ? String(fields.conversationId).trim()
          : sessionId,
  };
  void recordMcpToolExecution(env, {
    tenant_id: tenantId,
    workspace_id: workspaceId,
    tool_name: toolName,
    tool_key: toolName,
    success: false,
    error_message: err,
    duration_ms: 0,
    user_id: userId,
    status: 'error',
    session_id: sessionId,
    conversation_id: spine.conversation_id,
    agent_run_id: spine.agent_run_id,
    actor_source: 'catalog',
    source_tool: 'd1_policy_block',
  }).catch(() => {});
}

/**
 * @param {any} params
 * @param {any} env
 * @param {{ toolName: string, allowKinds?: string[] }} opts
 */
async function assertMutationToolAllowed(params, env, opts) {
  const { sql, user_id, workspace_id } = params;
  if (user_id && (!workspace_id || String(workspace_id).trim() === '' || String(workspace_id).trim() === '__tenant__')) {
    return { error: 'WORKSPACE_CONTEXT_MISSING' };
  }
  if (!sql) return { error: 'SQL query required' };
  const isPlatformOperator = await resolveIsPlatformOperator(env, user_id);
  const safety = evaluateDatabaseSqlSafety(sql, { isSuperadmin: isPlatformOperator });
  if (!safety.allowed) {
    await logPolicyBlock(env, {
      ...params,
      sql,
      error: safety.error || 'policy_block',
      tool_name: opts.toolName,
    });
    return { error: safety.error || 'SQL not permitted' };
  }
  const allowKinds = opts.allowKinds || ['mutation', 'schema', 'destructive'];
  if (!allowKinds.includes(safety.kind)) {
    const msg = `${opts.toolName} does not allow statement kind: ${safety.kind}`;
    await logPolicyBlock(env, { ...params, sql, error: msg, tool_name: opts.toolName });
    return { error: msg };
  }
  if (safety.requiresApproval) {
    return {
      error: `${opts.toolName} requires dashboard approval before execution.`,
      requires_approval: true,
      statement_kind: safety.kind,
    };
  }
  return { ok: true, safety, isPlatformOperator };
}

export const handlers = {
  async d1_query(params, env) {
    if (!env.DB) return { error: 'D1 binding (env.DB) not configured' };
    const { sql, params: bindings = [] } = params;
    if (!sql) return { error: 'SQL query required' };
    if (params.user_id && (!params.workspace_id || String(params.workspace_id).trim() === '' || String(params.workspace_id).trim() === '__tenant__')) {
      return { error: 'WORKSPACE_CONTEXT_MISSING' };
    }

    const gate = assertD1ReadOnlySelect(sql);
    if (!gate.ok) {
      await logPolicyBlock(env, { ...params, tool_name: 'd1_query' });
      return {
        error: `${gate.error} For mutations, use d1_write after dashboard approval.`,
      };
    }

    const pgOnly = assertD1SqlNotPostgresOnly(sql);
    if (pgOnly.blocked) {
      await logPolicyBlock(env, {
        ...params,
        sql,
        error: pgOnly.error,
        tool_name: 'd1_query',
      });
      return { error: pgOnly.error, user_message: pgOnly.user_message, wrong_data_plane: true };
    }

    try {
      const rows = await d1QueryCore({ sql, params: bindings }, env);
      return { success: true, results: rows || [], meta: {} };
    } catch (e) {
      return { error: `D1 Query Failed: ${e.message}` };
    }
  },

  async d1_write(params, env) {
    if (!env.DB) return { error: 'D1 binding (env.DB) not configured' };
    const check = await assertMutationToolAllowed(params, env, {
      toolName: 'd1_write',
      allowKinds: ['mutation', 'schema', 'destructive'],
    });
    if (check.error) return check;

    const contract = gateD1WriteContracts(params.sql, {
      allow_d1_contract_bypass: params.allow_d1_contract_bypass,
      env,
      audit: {
        surface: 'tools_db_d1_write',
        tool_name: 'd1_write',
        tenant_id: params.tenant_id ?? null,
        workspace_id: params.workspace_id ?? null,
        user_id: params.user_id ?? null,
        session_id: params.session_id ?? null,
        conversation_id: params.conversation_id ?? null,
      },
    });
    if (!contract.ok) {
      await logPolicyBlock(env, {
        ...params,
        sql: params.sql,
        error: contract.error,
        tool_name: 'd1_write',
      });
      return { error: contract.error, contract: contract.contract };
    }

    try {
      const bindings = Array.isArray(params.params) ? params.params : [];
      const res = await env.DB.prepare(params.sql).bind(...bindings).run();
      return {
        success: true,
        meta: res.meta,
        statement_kind: check.safety?.kind,
        ...d1WriteContractBypassResponseFields(contract),
      };
    } catch (e) {
      return { error: `D1 Write Failed: ${e.message}` };
    }
  },

  async d1_batch_write(params, env) {
    if (!env.DB) return { error: 'D1 binding (env.DB) not configured' };
    const queries = Array.isArray(params.queries) ? params.queries : [];
    if (!queries.length) return { error: 'queries array required' };

    for (const q of queries) {
      const check = await assertMutationToolAllowed(
        { ...params, sql: q?.sql },
        env,
        { toolName: 'd1_batch_write', allowKinds: ['mutation', 'schema', 'destructive'] },
      );
      if (check.error) return check;
      const contract = gateD1WriteContracts(q?.sql, {
        allow_d1_contract_bypass: params.allow_d1_contract_bypass,
        env,
        audit: {
          surface: 'tools_db_d1_batch_write',
          tool_name: 'd1_batch_write',
          tenant_id: params.tenant_id ?? null,
          workspace_id: params.workspace_id ?? null,
          user_id: params.user_id ?? null,
          session_id: params.session_id ?? null,
          conversation_id: params.conversation_id ?? null,
        },
      });
      if (!contract.ok) {
        await logPolicyBlock(env, {
          ...params,
          sql: q?.sql,
          error: contract.error,
          tool_name: 'd1_batch_write',
        });
        return { error: contract.error, contract: contract.contract };
      }
    }

    try {
      const statements = queries.map((q) => env.DB.prepare(q.sql).bind(...(q.params || [])));
      const results = await env.DB.batch(statements);
      return { success: true, results };
    } catch (e) {
      return { error: `D1 Batch Write Failed: ${e.message}` };
    }
  },

  async d1_explain(params, env) {
    if (!env.DB) return { error: 'D1 binding (env.DB) not configured' };
    const { sql } = params;
    if (!sql) return { error: 'SQL query required' };
    if (params.user_id && (!params.workspace_id || String(params.workspace_id).trim() === '' || String(params.workspace_id).trim() === '__tenant__')) {
      return { error: 'WORKSPACE_CONTEXT_MISSING' };
    }

    const gate = assertD1ReadOnlySelect(sql);
    if (!gate.ok) {
      await logPolicyBlock(env, { ...params, tool_name: 'd1_explain' });
      return { error: `${gate.error} EXPLAIN is read-only.` };
    }

    const pgOnly = assertD1SqlNotPostgresOnly(sql);
    if (pgOnly.blocked) {
      await logPolicyBlock(env, {
        ...params,
        sql,
        error: pgOnly.error,
        tool_name: 'd1_explain',
      });
      return { error: pgOnly.error, user_message: pgOnly.user_message, wrong_data_plane: true };
    }

    const explainSql = /^\s*EXPLAIN\b/i.test(sql) ? sql : `EXPLAIN QUERY PLAN ${sql}`;
    try {
      const res = await env.DB.prepare(explainSql).all();
      return { success: true, results: res?.results || [], meta: {} };
    } catch (e) {
      return { error: `d1_explain failed: ${e.message}` };
    }
  },

  async d1_schema(params, env) {
    return handlers.d1_schema_introspect(params, env);
  },

  async d1_schema_introspect(params, env) {
    if (!env.DB) return { error: 'D1 binding (env.DB) not configured' };
    if (params.user_id && (!params.workspace_id || String(params.workspace_id).trim() === '' || String(params.workspace_id).trim() === '__tenant__')) {
      return { error: 'WORKSPACE_CONTEXT_MISSING' };
    }
    const tbl = params.table != null ? String(params.table).trim() : '';
    try {
      if (tbl) {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tbl)) {
          return { error: 'Invalid table name (use letters, digits, underscore).' };
        }
        const res = await env.DB.prepare(`PRAGMA table_info(${tbl})`).all();
        return { success: true, table: tbl, columns: res?.results || [] };
      }
      const res = await env.DB.prepare(
        `SELECT name, type, sql FROM sqlite_master
         WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
         ORDER BY name ASC LIMIT 500`,
      ).all();
      return { success: true, objects: res?.results || [] };
    } catch (e) {
      return { error: `d1_schema_introspect failed: ${e.message}` };
    }
  },

  async hyperdrive_query(params, env) {
    if (!isHyperdriveUsable(env)) {
      return { error: 'Hyperdrive binding not configured or not usable' };
    }
    const { sql, params: bindings = [] } = params;
    if (!sql) return { error: 'SQL query required' };
    const trimmed = String(sql).trim();
    if (/^\s*DROP\s+DATABASE\b/i.test(trimmed)) {
      return { error: 'DROP DATABASE is not permitted via this API' };
    }

    const isPlatformOperator = await resolveIsSuperadmin(env, params.user_id);
    const safety = evaluateDatabaseSqlSafety(trimmed, { isSuperadmin });
    if (!safety.allowed) {
      await logPolicyBlock(env, { ...params, tool_name: 'hyperdrive_query' });
      return { error: safety.error || 'SQL not permitted', code: 'hyperdrive_read_only' };
    }
    if (safety.requiresApproval) {
      return {
        error: 'hyperdrive_query mutation requires dashboard approval.',
        requires_approval: true,
        statement_kind: safety.kind,
      };
    }

    const result = await runHyperdriveQuery(env, trimmed, Array.isArray(bindings) ? bindings : []);
    if (!result.ok) {
      return { error: result.error || 'Hyperdrive query failed', results: [] };
    }
    return {
      success: true,
      results: result.rows ?? [],
      meta: result.meta ?? { rows_read: (result.rows ?? []).length },
    };
  },

  async hyperdrive_schema(params, env) {
    if (!isHyperdriveUsable(env)) {
      return { error: 'Hyperdrive binding not configured or not usable' };
    }
    const table = params.table != null ? String(params.table).trim() : '';
    try {
      if (table) {
        pgQuoteIdent(table);
        const colsR = await runHyperdriveQuery(
          env,
          `SELECT c.column_name AS name, c.data_type AS type,
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
                WHERE tc.table_schema = 'public'
                  AND tc.table_name = $1
                  AND tc.constraint_type = 'PRIMARY KEY'
             ) pk ON pk.column_name = c.column_name
            WHERE c.table_schema = 'public' AND c.table_name = $1
            ORDER BY c.ordinal_position`,
          [table],
        );
        if (!colsR.ok) throw new Error(colsR.error || 'schema_failed');
        return { success: true, table, columns: colsR.rows ?? [] };
      }

      const tablesR = await runHyperdriveQuery(
        env,
        `SELECT table_name AS name, table_type AS type
           FROM information_schema.tables
          WHERE table_schema = 'public'
          ORDER BY table_name`,
        [],
      );
      if (!tablesR.ok) throw new Error(tablesR.error || 'tables_failed');
      return { success: true, tables: tablesR.rows ?? [] };
    } catch (e) {
      return { error: `hyperdrive_schema failed: ${e.message}` };
    }
  },

  async hyperdrive_explain(params, env) {
    if (!isHyperdriveUsable(env)) {
      return { error: 'Hyperdrive binding not configured or not usable' };
    }
    const { sql } = params;
    if (!sql) return { error: 'SQL query required' };

    const inner = String(sql).trim().replace(/^\s*EXPLAIN\s+(?:ANALYZE\s+)?/i, '');
    const isPlatformOperator = await resolveIsSuperadmin(env, params.user_id);
    const safety = evaluateDatabaseSqlSafety(inner, { isSuperadmin });
    if (safety.kind !== 'read' && safety.kind !== 'explain') {
      await logPolicyBlock(env, { ...params, sql, tool_name: 'hyperdrive_explain' });
      return { error: safety.error || 'Only read-only statements can be explained' };
    }

    const explainSql = /^\s*EXPLAIN\b/i.test(sql) ? sql : `EXPLAIN ${inner}`;
    const result = await runHyperdriveQuery(env, explainSql, []);
    if (!result.ok) {
      return { error: result.error || 'hyperdrive_explain failed', results: [] };
    }
    return { success: true, results: result.rows ?? [], meta: result.meta ?? {} };
  },
};

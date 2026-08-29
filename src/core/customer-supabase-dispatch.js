/**
 * Customer / account Supabase — Management API SQL via caller OAuth (never env.HYPERDRIVE).
 */
import { getUserSupabaseToken } from '../../backend/identity/oauth/user-token.js';
import {
  getDefaultWorkspaceDataBinding,
  upsertWorkspaceDataBinding,
  listWorkspaceDataBindings,
} from './workspace-data-bindings.js';
import { evaluateDataPlaneOperation } from './database-operation-policy.js';
import { detectProtectedDatabaseSchema } from './database-operation-policy.js';
import { logCustomerDataPlaneEvent } from './customer-data-plane-telemetry.js';
import {
  generateRollbackStub,
  verifyDatabaseApproval,
} from './database-assistant-dispatch.js';
import { classifyDatabaseSqlStatement } from './database-sql-safety.js';
import { logDataPlaneSecurityEvent, USER_ACCOUNT_DATA_PLANE } from './data-plane-access-guard.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {string} accessToken
 */
async function managementFetch(accessToken, path, init = {}) {
  const res = await fetch(`https://api.supabase.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.message || data?.error || data?.error_description || `supabase_api_${res.status}`;
    throw new Error(String(msg));
  }
  return data;
}

/**
 * Live project catalog for the caller's Management OAuth token.
 * @param {string} accessToken
 * @returns {Promise<Array<{ id: string, name: string, ref: string, region?: string|null }>>}
 */
export async function listOAuthAccountSupabaseProjects(accessToken) {
  const data = await managementFetch(accessToken, '/v1/projects');
  const rows = Array.isArray(data) ? data : [];
  return rows.map((p) => ({
    id: p.id != null ? String(p.id) : '',
    name: p.name != null ? String(p.name) : '',
    ref: p.ref != null ? String(p.ref) : '',
    region: p.region != null ? String(p.region) : null,
  })).filter((p) => p.ref || p.id);
}

/**
 * Operator: unscoped (audited). Non-operator: project must appear in live Management catalog.
 *
 * @param {any} env
 * @param {string|null|undefined} userId
 * @param {string|null|undefined} projectRefOrId
 * @param {unknown} [authUser]
 * @param {string|null} [workspaceId]
 */
export async function assertCallerOwnsProjectRef(
  env,
  userId,
  projectRefOrId,
  authUser = null,
  workspaceId = null,
) {
  const wanted = trim(projectRefOrId);
  if (!wanted) {
    return {
      ok: false,
      error: 'project_ref_required',
      user_message: 'Pass project_ref (or select a project) before running SQL.',
    };
  }

  const uid = trim(userId);
  if (!uid) {
    return {
      ok: false,
      error: 'user_oauth_required',
      user_message: 'Sign in before using Supabase tools.',
    };
  }

  const tok = await getUserSupabaseToken(env, uid, workspaceId);
  if (!tok?.access_token) {
    return {
      ok: false,
      error: 'supabase_not_connected',
      reauth_required: true,
      user_message: 'Connect Supabase in Integrations before using Postgres tools.',
    };
  }

  let catalog = [];
  try {
    catalog = await listOAuthAccountSupabaseProjects(tok.access_token);
  } catch (e) {
    return {
      ok: false,
      error: 'supabase_projects_list_failed',
      user_message: e?.message ? String(e.message) : 'Could not list Supabase projects for your account.',
    };
  }

  const match = catalog.find(
    (p) =>
      p.ref.toLowerCase() === wanted.toLowerCase() ||
      p.id.toLowerCase() === wanted.toLowerCase(),
  );
  if (!match) {
    logDataPlaneSecurityEvent('supabase_project_not_in_caller_account', {
      user_id: uid,
      project_ref: wanted,
      auth_scope: USER_ACCOUNT_DATA_PLANE,
    });
    return {
      ok: false,
      error: 'project_ref_not_in_account',
      user_message:
        'That Supabase project is not in your connected Management account. List projects and pick a valid project_ref.',
    };
  }

  return {
    ok: true,
    auth_scope: USER_ACCOUNT_DATA_PLANE,
    access_token: tok.access_token,
    project_ref: match.ref || wanted,
    project_id: match.id,
    projects: catalog,
  };
}

/**
 * @param {any} env
 * @param {string} userId
 * @param {string|null} workspaceId
 */
export async function customerSupabaseListProjects(env, userId, workspaceId = null) {
  const tok = await getUserSupabaseToken(env, userId, workspaceId);
  if (!tok?.access_token) return { ok: false, projects: [], error: 'supabase_not_connected' };

  let projects = [];
  try {
    projects = await listOAuthAccountSupabaseProjects(tok.access_token);
  } catch {
    projects = Array.isArray(tok.projects) ? tok.projects : [];
  }

  const bindings = workspaceId ? await listWorkspaceDataBindings(env, workspaceId, 'supabase') : [];
  const pinned = workspaceId ? await getDefaultWorkspaceDataBinding(env, workspaceId, 'supabase') : null;
  return {
    ok: true,
    projects,
    bindings,
    pinned_project_ref: pinned?.external_project_ref != null ? String(pinned.external_project_ref) : null,
    auth_scope: USER_ACCOUNT_DATA_PLANE,
  };
}

/**
 * @param {any} env
 * @param {{
 *   user_id: string,
 *   tenant_id: string,
 *   workspace_id: string,
 *   project_id: string,
 *   project_ref?: string|null,
 *   display_name?: string|null,
 *   authUser?: unknown,
 * }} opts
 */
export async function customerSupabaseSelectProjectForWorkspace(env, opts) {
  const projectId = String(opts.project_id || opts.project_ref || '').trim();
  const owned = await assertCallerOwnsProjectRef(
    env,
    opts.user_id,
    projectId,
    opts.authUser || null,
    opts.workspace_id,
  );
  if (!owned.ok) return { ok: false, error: owned.error, user_message: owned.user_message };
  if (!owned.access_token) return { ok: false, error: 'supabase_not_connected' };

  const ref = owned.project_ref || projectId;
  const id = `wsbind_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

  await upsertWorkspaceDataBinding(env, {
    id,
    tenant_id: opts.tenant_id,
    user_id: opts.user_id,
    workspace_id: opts.workspace_id,
    provider: 'supabase',
    connection_id: 'supabase_oauth',
    external_project_id: owned.project_id || projectId,
    external_project_ref: ref,
    display_name: opts.display_name || ref,
    selected_as_default: true,
    capabilities_json: JSON.stringify({
      readonly_sql: true,
      write_sql: true,
      schema_inspect: true,
      migrations_propose: true,
    }),
    health_status: 'selected',
    last_verified_at: Math.floor(Date.now() / 1000),
  });

  return { ok: true, binding_id: id, project_ref: ref, project_id: owned.project_id || projectId };
}

/**
 * @param {string} accessToken
 * @param {string} projectRef
 */
async function customerSupabaseRunQuery(accessToken, projectRef, sql) {
  const data = await managementFetch(accessToken, `/v1/projects/${encodeURIComponent(projectRef)}/database/query`, {
    method: 'POST',
    body: JSON.stringify({ query: String(sql || '') }),
  });
  if (Array.isArray(data)) return { ok: true, rows: data };
  if (Array.isArray(data?.result)) return { ok: true, rows: data.result };
  if (Array.isArray(data?.rows)) return { ok: true, rows: data.rows };
  return { ok: true, rows: [], raw: data };
}

/**
 * Resolve Management token + project_ref. Workspace pin is optional default only.
 * @param {any} env
 * @param {string} userId
 * @param {string} workspaceId
 * @param {{ project_ref?: string|null, project_id?: string|null, authUser?: unknown }} [opts]
 */
async function resolveProjectRef(env, userId, workspaceId, opts = {}) {
  const requested = trim(opts.project_ref || opts.project_id);
  const binding = workspaceId
    ? await getDefaultWorkspaceDataBinding(env, workspaceId, 'supabase')
    : null;
  const pinned = binding?.external_project_ref != null ? String(binding.external_project_ref) : '';
  const candidate = requested || pinned;

  if (!candidate) {
    const tok = await getUserSupabaseToken(env, userId, workspaceId);
    if (!tok?.access_token) return { error: 'supabase_not_connected' };
    return { error: 'project_ref_required', access_token: tok.access_token };
  }

  const owned = await assertCallerOwnsProjectRef(
    env,
    userId,
    candidate,
    opts.authUser || null,
    workspaceId,
  );
  if (!owned.ok) {
    return {
      error: owned.error || 'project_ref_not_in_account',
      user_message: owned.user_message,
    };
  }
  if (!owned.access_token) return { error: 'supabase_not_connected' };

  return {
    access_token: owned.access_token,
    project_ref: owned.project_ref,
    binding,
    auth_scope: owned.auth_scope,
  };
}

/**
 * @param {any} env
 * @param {{
 *   operation: string,
 *   user_id: string,
 *   tenant_id?: string|null,
 *   workspace_id: string,
 *   sql?: string,
 *   params?: unknown[],
 *   migration_sql?: string,
 *   approval_id?: string|null,
 *   schema?: string,
 *   table?: string,
 *   project_ref?: string|null,
 *   project_id?: string|null,
 *   authUser?: unknown,
 *   agent_run_id?: string|null,
 * }} opts
 */
export async function dispatchCustomerSupabase(env, opts) {
  const t0 = Date.now();
  const operation = String(opts.operation || '').trim();
  const userId = String(opts.user_id || '');
  const workspaceId = String(opts.workspace_id || '');

  if (operation === 'list_projects') {
    const out = await customerSupabaseListProjects(env, userId, workspaceId || null);
    return {
      ...out,
      operation,
      data_plane: 'customer_supabase',
      duration_ms: Date.now() - t0,
    };
  }

  const resolved = await resolveProjectRef(env, userId, workspaceId, {
    project_ref: opts.project_ref,
    project_id: opts.project_id || opts.table,
    authUser: opts.authUser,
  });
  if (resolved.error) {
    const err =
      resolved.error === 'supabase_not_connected'
        ? 'customer_database_not_connected'
        : resolved.error;
    return {
      ok: false,
      operation,
      data_plane: 'customer_supabase',
      error: err,
      reason: err,
      user_message:
        resolved.user_message ||
        (resolved.error === 'project_ref_required'
          ? 'Select a Supabase project (or pass project_ref) before running SQL.'
          : 'Connect Supabase in Integrations, then pick a project from your account.'),
      onboarding_required: resolved.error === 'supabase_not_connected',
      duration_ms: Date.now() - t0,
    };
  }

  const { access_token, project_ref, binding } = resolved;
  const connection_id = binding?.id != null ? String(binding.id) : 'supabase_oauth';

  /** @type {Record<string, () => Promise<Record<string, unknown>>>} */
  const handlers = {
    select_project_for_workspace: async () =>
      customerSupabaseSelectProjectForWorkspace(env, {
        user_id: userId,
        tenant_id: String(opts.tenant_id || ''),
        workspace_id: workspaceId,
        project_id: String(opts.project_id || opts.table || project_ref || ''),
        project_ref: opts.project_ref || project_ref,
        display_name: opts.table,
        authUser: opts.authUser,
      }),
    inspect_schema: async () => {
      const data = await managementFetch(
        access_token,
        `/v1/projects/${encodeURIComponent(project_ref)}/database/tables`,
      );
      const tables = Array.isArray(data) ? data : data?.tables || data?.data || [];
      return { ok: true, tables, project_ref };
    },
    list_tables: async () => handlers.inspect_schema(),
    get_project: async () => ({
      ok: true,
      project: await managementFetch(
        access_token,
        `/v1/projects/${encodeURIComponent(project_ref)}`,
      ),
    }),
    list_branches: async () => {
      const branches = await managementFetch(
        access_token,
        `/v1/projects/${encodeURIComponent(project_ref)}/branches`,
      );
      return { ok: true, branches: Array.isArray(branches) ? branches : branches?.data || [] };
    },
    list_migrations: async () => {
      const migrations = await managementFetch(
        access_token,
        `/v1/projects/${encodeURIComponent(project_ref)}/database/migrations`,
      );
      return {
        ok: true,
        migrations: Array.isArray(migrations) ? migrations : migrations?.data || [],
      };
    },
    query_logs: async () => {
      const query = new URLSearchParams();
      if (trim(opts.log_sql)) query.set('sql', trim(opts.log_sql));
      if (trim(opts.iso_timestamp_start)) {
        query.set('iso_timestamp_start', trim(opts.iso_timestamp_start));
      }
      if (trim(opts.iso_timestamp_end)) {
        query.set('iso_timestamp_end', trim(opts.iso_timestamp_end));
      }
      const suffix = query.toString() ? `?${query.toString()}` : '';
      const logs = await managementFetch(
        access_token,
        `/v1/projects/${encodeURIComponent(project_ref)}/analytics/endpoints/logs.all${suffix}`,
      );
      return { ok: true, logs };
    },
    get_database_context: async () => ({
      ok: true,
      context: await managementFetch(
        access_token,
        `/v1/projects/${encodeURIComponent(project_ref)}/database/context`,
      ),
    }),
    describe_table: async () => {
      const table = String(opts.table || '').trim();
      if (!table) throw new Error('table required');
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw new Error('invalid table identifier');
      const schema = trim(opts.schema);
      if (!schema) throw new Error('schema required');
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('invalid schema identifier');
      const sql = `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = '${schema}' AND table_name = '${table}'
        ORDER BY ordinal_position`;
      return customerSupabaseRunQuery(access_token, project_ref, sql);
    },
    run_readonly_sql: async () => {
      const sql = String(opts.sql || '').trim();
      if (Array.isArray(opts.params) && opts.params.length) {
        return {
          ok: false,
          error: 'supabase_management_params_unsupported',
          user_message:
            'Parameterized SQL is available on the platform Supabase/Hyperdrive lane. The Supabase Management SQL API accepts query text only.',
        };
      }
      const policy = evaluateDataPlaneOperation({
        owner_type: 'customer',
        operation_type: 'run_readonly_sql',
        sql,
        is_owner: false,
        provider: 'supabase',
        schema: opts.schema || null,
      });
      if (!policy.allowed) return { ok: false, error: policy.reason, policy };
      const stmtKind = classifyDatabaseSqlStatement(sql);
      if (stmtKind !== 'read' && stmtKind !== 'explain') {
        return {
          ok: false,
          error: 'readonly_operation_required',
          policy,
          user_message: 'This path only allows SELECT/EXPLAIN. Use a write operation for mutations.',
        };
      }
      return customerSupabaseRunQuery(access_token, project_ref, sql);
    },
    run_write_sql: async () => {
      const sql = String(opts.sql || opts.migration_sql || '').trim();
      const approvalId = trim(opts.approval_id);
      if (Array.isArray(opts.params) && opts.params.length) {
        return {
          ok: false,
          error: 'supabase_management_params_unsupported',
          user_message:
            'Parameterized SQL is available on the platform Supabase/Hyperdrive lane. The Supabase Management SQL API accepts query text only.',
        };
      }
      const policy = evaluateDataPlaneOperation({
        owner_type: 'customer',
        operation_type: 'execute_sql',
        sql,
        is_owner: false,
        provider: 'supabase',
        schema: opts.schema || null,
        explicit_approval_id: opts.approval_id,
      });
      if (!policy.allowed) return { ok: false, error: policy.reason, policy };
      const stmtKind = classifyDatabaseSqlStatement(sql);
      if (stmtKind === 'read' || stmtKind === 'explain') {
        return {
          ok: false,
          error: 'write_operation_required',
          user_message: 'supabase.write requires INSERT, UPDATE, DELETE, or DDL — not SELECT.',
        };
      }
      const approval = await verifyDatabaseApproval(
        env,
        approvalId,
        {
          user_id: userId,
          tenant_id: opts.tenant_id || null,
          workspace_id: workspaceId || null,
        },
        sql,
      );
      if (!approval.ok) {
        return {
          ok: false,
          error: approval.error,
          requires_approval: true,
          protected_schema: detectProtectedDatabaseSchema(sql, opts.schema) || null,
        };
      }
      if (stmtKind === 'mutation' && !/\bRETURNING\b/i.test(sql)) {
        return {
          ok: false,
          error: 'database_write_readback_required',
          user_message: 'INSERT, UPDATE, and DELETE must include RETURNING for an auditable readback.',
        };
      }
      const out = await customerSupabaseRunQuery(access_token, project_ref, sql);
      if (out.ok) {
        await env.DB?.prepare(
          `UPDATE agentsam_approval_queue
              SET status = 'consumed', decided_at = COALESCE(decided_at, unixepoch())
            WHERE id = ? AND status = 'approved'`,
        )
          .bind(approvalId)
          .run()
          .catch(() => null);
      }
      return {
        ...out,
        approval_id: approvalId,
        receipt: {
          id: `dbwr_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
          provider: 'supabase',
          resource_ref: project_ref,
          schema: opts.schema || null,
          readback_rows: out.rows || [],
        },
        refresh: { schema: stmtKind === 'schema', data: stmtKind !== 'schema' },
      };
    },
    execute_sql: async () => {
      const sql = String(opts.sql || '').trim();
      const stmtKind = classifyDatabaseSqlStatement(sql);
      if (stmtKind === 'read' || stmtKind === 'explain') {
        return handlers.run_readonly_sql();
      }
      return handlers.run_write_sql();
    },
    supabase_write: async () => handlers.run_write_sql(),
    customer_supabase_readonly_query: async () => handlers.run_readonly_sql(),
    propose_migration: async () => {
      const migrationSql = String(opts.migration_sql || opts.sql || '').trim();
      return {
        ok: true,
        migration_sql: migrationSql,
        rollback_sql: generateRollbackStub(migrationSql),
        requires_approval: true,
        applied: false,
        project_ref,
      };
    },
    validate_migration: async () => {
      const migrationSql = String(opts.migration_sql || opts.sql || '').trim();
      const kind = classifyDatabaseSqlStatement(migrationSql);
      return { ok: kind !== 'unknown', statement_kind: kind };
    },
    apply_approved_migration: async () => {
      const migrationSql = String(opts.migration_sql || opts.sql || '').trim();
      const approvalId = trim(opts.approval_id);
      if (!migrationSql) return { ok: false, error: 'migration_sql_required' };
      const approval = await verifyDatabaseApproval(
        env,
        approvalId,
        {
          user_id: userId,
          tenant_id: opts.tenant_id || null,
          workspace_id: workspaceId || null,
        },
        migrationSql,
      );
      if (!approval.ok) {
        return { ok: false, error: approval.error, requires_approval: true };
      }
      const receiptId = `dbmig_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
      const applied = await managementFetch(
        access_token,
        `/v1/projects/${encodeURIComponent(project_ref)}/database/migrations`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': receiptId },
          body: JSON.stringify({
            query: migrationSql,
            name: trim(opts.migration_name) || `agentsam_${Date.now()}`,
            ...(trim(opts.rollback_sql) ? { rollback: trim(opts.rollback_sql) } : {}),
          }),
        },
      );
      await env.DB.prepare(
        `UPDATE agentsam_approval_queue
            SET status = 'consumed', decided_at = COALESCE(decided_at, unixepoch())
          WHERE id = ? AND status = 'approved'`,
      )
        .bind(approvalId)
        .run()
        .catch(() => null);
      return {
        ok: true,
        applied: true,
        approval_id: approvalId,
        transport: 'management_api',
        receipt: {
          id: receiptId,
          provider: 'supabase',
          resource_ref: project_ref,
          response: applied,
        },
        refresh: { schema: true, data: true },
      };
    },
    generate_rollback: async () => ({
      ok: true,
      rollback_sql: generateRollbackStub(String(opts.migration_sql || opts.sql || '')),
    }),
  };

  const handler = handlers[operation];
  if (!handler) {
    return {
      ok: false,
      operation,
      data_plane: 'customer_supabase',
      error: `unknown_operation:${operation}`,
    };
  }

  try {
    const payload = await handler();
    const ok = payload.ok !== false;
    await logCustomerDataPlaneEvent(env, {
      user_id: userId,
      tenant_id: opts.tenant_id,
      workspace_id: workspaceId,
      data_plane: 'customer_supabase',
      owner_type: 'customer',
      provider: 'supabase',
      connection_id,
      external_project_id: binding?.external_project_id,
      operation_type: operation,
      sql_class: opts.sql ? classifyDatabaseSqlStatement(String(opts.sql)) : null,
      approval_id: opts.approval_id,
      success: ok,
      error_message: ok ? null : payload.error,
      duration_ms: Date.now() - t0,
      sql: opts.sql || opts.migration_sql,
      agent_run_id: opts.agent_run_id,
    });
    return {
      ...payload,
      ok,
      operation,
      data_plane: 'customer_supabase',
      owner_type: 'customer',
      project_ref,
      connection_id,
      auth_scope: resolved.auth_scope || USER_ACCOUNT_DATA_PLANE,
      transport: 'management_api',
      duration_ms: Date.now() - t0,
      read_only: ['run_readonly_sql', 'list_tables', 'inspect_schema', 'describe_table'].includes(operation),
      write_path: ['run_write_sql', 'execute_sql', 'supabase_write', 'apply_approved_migration'].includes(
        operation,
      ),
    };
  } catch (e) {
    await logCustomerDataPlaneEvent(env, {
      user_id: userId,
      tenant_id: opts.tenant_id,
      workspace_id: workspaceId,
      data_plane: 'customer_supabase',
      provider: 'supabase',
      connection_id,
      operation_type: operation,
      success: false,
      error_message: e?.message ? String(e.message) : String(e),
      duration_ms: Date.now() - t0,
      sql: opts.sql,
      agent_run_id: opts.agent_run_id,
    });
    return {
      ok: false,
      operation,
      data_plane: 'customer_supabase',
      error: e?.message ? String(e.message) : String(e),
      duration_ms: Date.now() - t0,
    };
  }
}

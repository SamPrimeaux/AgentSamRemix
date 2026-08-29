/**
 * Customer Cloudflare account resources — OAuth API path (never platform env.DB).
 */
import { getOAuthToken } from '../../backend/identity/oauth/user-token.js';
import {
  getDefaultWorkspaceDataBinding,
  upsertWorkspaceDataBinding,
  listWorkspaceDataBindings,
} from './workspace-data-bindings.js';
import { resolveWorkspaceCloudflareCredentials } from './workspace-cloudflare-credentials.js';
import { evaluateDataPlaneOperation } from './database-operation-policy.js';
import { logCustomerDataPlaneEvent } from './customer-data-plane-telemetry.js';
import { generateRollbackStub } from './database-assistant-dispatch.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {string} token
 * @param {string} path
 * @param {RequestInit} [init]
 */
export async function cfApi(token, path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!data?.success) {
    const msg = data?.errors?.[0]?.message || `cloudflare_api_${res.status}`;
    throw new Error(String(msg));
  }
  return data.result;
}

/**
 * @param {any} env
 * @param {string} userId
 * @param {string} tenantId
 * @param {string} workspaceId
 */
async function resolveCloudflareApiToken(env, userId, tenantId, workspaceId) {
  if (workspaceId && tenantId) {
    const byo = await resolveWorkspaceCloudflareCredentials(env, userId, tenantId, workspaceId);
    if (byo.ok && byo.token) {
      return {
        token: byo.token,
        source: byo.credential_source === 'oauth' ? 'oauth' : 'byo_api_key',
        account_id: byo.account_id,
      };
    }
  }
  const oauth = await getOAuthToken(env, userId, 'cloudflare');
  if (oauth) return { token: oauth, source: 'oauth', account_id: null };
  return { token: null, source: null, account_id: null };
}

/**
 * @param {any} env
 * @param {string} userId
 * @param {string} [tenantId]
 * @param {string} [workspaceId]
 */
export async function customerCloudflareListAccounts(env, userId, tenantId = '', workspaceId = '') {
  const resolved = await resolveCloudflareApiToken(env, userId, tenantId, workspaceId);
  if (!resolved.token) return { ok: false, accounts: [], error: 'cloudflare_not_connected' };
  const accounts = await cfApi(resolved.token, '/accounts');
  return { ok: true, accounts: Array.isArray(accounts) ? accounts : [] };
}

/**
 * @param {any} env
 * @param {string} userId
 * @param {string} accountId
 * @param {string} [tenantId]
 * @param {string} [workspaceId]
 */
export async function customerCloudflareListD1(env, userId, accountId, tenantId = '', workspaceId = '') {
  const resolved = await resolveCloudflareApiToken(env, userId, tenantId, workspaceId);
  if (!resolved.token) return { ok: false, databases: [], error: 'cloudflare_not_connected' };
  const databases = await cfApi(
    resolved.token,
    `/accounts/${encodeURIComponent(accountId)}/d1/database`,
  );
  return { ok: true, databases: Array.isArray(databases) ? databases : [] };
}

/**
 * @param {any} env
 * @param {string} userId
 * @param {string} accountId
 * @param {string} [tenantId]
 * @param {string} [workspaceId]
 */
export async function customerCloudflareListR2(env, userId, accountId, tenantId = '', workspaceId = '') {
  const resolved = await resolveCloudflareApiToken(env, userId, tenantId, workspaceId);
  if (!resolved.token) return { ok: false, buckets: [], error: 'cloudflare_not_connected' };
  const buckets = await cfApi(
    resolved.token,
    `/accounts/${encodeURIComponent(accountId)}/r2/buckets`,
  );
  return { ok: true, buckets: Array.isArray(buckets) ? buckets : [] };
}

/**
 * @param {any} env
 * @param {string} userId
 * @param {string} accountId
 * @param {string} [tenantId]
 * @param {string} [workspaceId]
 */
export async function customerCloudflareListHyperdrive(env, userId, accountId, tenantId = '', workspaceId = '') {
  const resolved = await resolveCloudflareApiToken(env, userId, tenantId, workspaceId);
  if (!resolved.token) return { ok: false, configs: [], error: 'cloudflare_not_connected' };
  const configs = await cfApi(
    resolved.token,
    `/accounts/${encodeURIComponent(accountId)}/hyperdrive/configs`,
  );
  return { ok: true, configs: Array.isArray(configs) ? configs : [] };
}

/**
 * @param {any} env
 * @param {string} userId
 * @param {string} accountId
 * @param {string} [tenantId]
 * @param {string} [workspaceId]
 */
export async function customerCloudflareListVectorize(env, userId, accountId, tenantId = '', workspaceId = '') {
  const resolved = await resolveCloudflareApiToken(env, userId, tenantId, workspaceId);
  if (!resolved.token) return { ok: false, indexes: [], error: 'cloudflare_not_connected' };
  const indexes = await cfApi(
    resolved.token,
    `/accounts/${encodeURIComponent(accountId)}/vectorize/v2/indexes`,
  );
  return { ok: true, indexes: Array.isArray(indexes) ? indexes : [] };
}

/**
 * @param {any} env
 * @param {string} userId
 * @param {string} accountId
 */
export async function customerCloudflareListWorkers(env, userId, accountId) {
  const token = await getOAuthToken(env, userId, 'cloudflare');
  if (!token) return { ok: false, scripts: [], error: 'cloudflare_not_connected' };
  const scripts = await cfApi(token, `/accounts/${encodeURIComponent(accountId)}/workers/scripts`);
  return { ok: true, scripts: Array.isArray(scripts) ? scripts : [] };
}

/**
 * @param {any} env
 * @param {{
 *   user_id: string,
 *   tenant_id: string,
 *   workspace_id: string,
 *   account_id: string,
 *   database_id: string,
 *   display_name?: string,
 * }} opts
 */
export async function customerCloudflareSelectWorkspaceResource(env, opts) {
  const id = `wsbind_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  await upsertWorkspaceDataBinding(env, {
    id,
    tenant_id: opts.tenant_id,
    user_id: opts.user_id,
    workspace_id: opts.workspace_id,
    provider: 'cloudflare_d1',
    connection_id: 'byo_api_key',
    external_account_id: String(opts.account_id),
    external_database_id: String(opts.database_id),
    display_name: opts.display_name || opts.database_id,
    selected_as_default: true,
    capabilities_json: JSON.stringify({ d1_readonly: true, d1_migrate_approval: true }),
    health_status: 'selected',
    last_verified_at: Math.floor(Date.now() / 1000),
  });
  return { ok: true, binding_id: id };
}

/**
 * @param {any} env
 * @param {string} userId
 * @param {string} workspaceId
 * @param {string} [tenantId]
 */
async function resolveD1Binding(env, userId, workspaceId, tenantId = '') {
  const binding = await getDefaultWorkspaceDataBinding(env, workspaceId, 'cloudflare_d1');
  const accountId = binding?.external_account_id != null ? String(binding.external_account_id) : null;
  const databaseId = binding?.external_database_id != null ? String(binding.external_database_id) : null;
  if (!accountId || !databaseId) return { error: 'no_cloudflare_d1_selected', binding };

  const resolved = await resolveCloudflareApiToken(env, userId, tenantId, workspaceId);
  if (!resolved.token) return { error: 'cloudflare_not_connected', binding };
  return {
    token: resolved.token,
    accountId,
    databaseId,
    binding,
    credential_source: resolved.source,
  };
}

/**
 * @param {string} token
 * @param {string} accountId
 * @param {string} databaseId
 * @param {string} sql
 */
async function d1Query(token, accountId, databaseId, sql) {
  const result = await cfApi(
    token,
    `/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`,
    { method: 'POST', body: JSON.stringify({ sql: String(sql || '') }) },
  );
  const rows = result?.[0]?.results ?? result?.results ?? [];
  return { ok: true, rows };
}

/**
 * @param {any} env
 * @param {{
 *   operation: string,
 *   user_id: string,
 *   tenant_id?: string|null,
 *   workspace_id: string,
 *   sql?: string,
 *   migration_sql?: string,
 *   approval_id?: string|null,
 *   account_id?: string,
 *   agent_run_id?: string|null,
 * }} opts
 */
export async function dispatchCustomerCloudflare(env, opts) {
  const t0 = Date.now();
  const operation = String(opts.operation || '').trim();
  const userId = String(opts.user_id || '');
  const workspaceId = String(opts.workspace_id || '');

  /** @type {Record<string, () => Promise<Record<string, unknown>>>} */
  const handlers = {
    list_accounts: async () => {
      const out = await customerCloudflareListAccounts(
        env,
        userId,
        String(opts.tenant_id || ''),
        workspaceId,
      );
      return out;
    },
    list_d1_databases: async () => {
      const accountId = String(opts.account_id || '').trim();
      if (!accountId) {
        const accts = await customerCloudflareListAccounts(
          env,
          userId,
          String(opts.tenant_id || ''),
          workspaceId,
        );
        const first = accts.accounts?.[0]?.id;
        if (!first) return { ok: false, error: 'account_id_required' };
        return customerCloudflareListD1(
          env,
          userId,
          String(first),
          String(opts.tenant_id || ''),
          workspaceId,
        );
      }
      return customerCloudflareListD1(
        env,
        userId,
        accountId,
        String(opts.tenant_id || ''),
        workspaceId,
      );
    },
    list_r2_buckets: async () => {
      const accountId = String(opts.account_id || '').trim();
      if (!accountId) {
        const accts = await customerCloudflareListAccounts(
          env,
          userId,
          String(opts.tenant_id || ''),
          workspaceId,
        );
        const first = accts.accounts?.[0]?.id;
        if (!first) return { ok: false, error: 'account_id_required' };
        return customerCloudflareListR2(
          env,
          userId,
          String(first),
          String(opts.tenant_id || ''),
          workspaceId,
        );
      }
      return customerCloudflareListR2(
        env,
        userId,
        accountId,
        String(opts.tenant_id || ''),
        workspaceId,
      );
    },
    list_workers: async () => {
      const accountId = String(opts.account_id || '').trim();
      if (!accountId) return { ok: false, error: 'account_id_required' };
      return customerCloudflareListWorkers(env, userId, accountId);
    },
    select_workspace_resource: async () =>
      customerCloudflareSelectWorkspaceResource(env, {
        user_id: userId,
        tenant_id: String(opts.tenant_id || ''),
        workspace_id: workspaceId,
        account_id: String(opts.account_id || ''),
        database_id: String(opts.table || opts.database_id || ''),
        display_name: opts.table,
      }),
    d1_readonly_query: async () => {
      const resolved = await resolveD1Binding(env, userId, workspaceId, String(opts.tenant_id || ''));
      if (resolved.error) return { ok: false, error: resolved.error };
      const sql = String(opts.sql || '').trim();
      const policy = evaluateDataPlaneOperation({
        owner_type: 'customer',
        operation_type: 'run_readonly_sql',
        sql,
        provider: 'cloudflare_d1',
      });
      if (!policy.allowed) return { ok: false, error: policy.reason, policy };
      return d1Query(resolved.token, resolved.accountId, resolved.databaseId, sql);
    },
    d1_apply_approved_migration: async () => {
      const resolved = await resolveD1Binding(env, userId, workspaceId, String(opts.tenant_id || ''));
      if (resolved.error) return { ok: false, error: resolved.error };
      const sql = String(opts.migration_sql || opts.sql || '').trim();
      const approvalId = opts.approval_id != null ? String(opts.approval_id).trim() : '';
      const policy = evaluateDataPlaneOperation({
        owner_type: 'customer',
        operation_type: 'apply_migration',
        sql,
        explicit_approval_id: approvalId,
        provider: 'cloudflare_d1',
      });
      if (!policy.allowed) return { ok: false, error: policy.reason, requires_approval: true };
      const out = await d1Query(resolved.token, resolved.accountId, resolved.databaseId, sql);
      return { ...out, applied: out.ok, approval_id: approvalId || null };
    },
    propose_migration: async () => ({
      ok: true,
      migration_sql: String(opts.migration_sql || opts.sql || ''),
      rollback_sql: generateRollbackStub(String(opts.migration_sql || opts.sql || '')),
      requires_approval: true,
      applied: false,
    }),
    r2_list: async () => ({
      ok: false,
      error: 'r2_list_not_supported',
      user_message:
        'Cloudflare OAuth lists accounts/D1 — not R2 object keys. Use r2_read/r2_write with your R2 API keys in Settings → Storage.',
    }),
    r2_read: async () => ({
      ok: false,
      error: 'use_r2_catalog_tools',
      user_message: 'Use agentsam r2_read / r2_write / r2_delete with bucket + key (user R2 credentials).',
    }),
    r2_write: async () => ({
      ok: false,
      error: 'use_r2_catalog_tools',
      user_message: 'Use r2_write with bucket + key after connecting R2 in Settings → Storage.',
    }),
  };

  const handler = handlers[operation];
  if (!handler) {
    return {
      ok: false,
      operation,
      data_plane: 'customer_cloudflare_d1',
      error: `unknown_operation:${operation}`,
    };
  }

  const data_plane = operation.startsWith('r2_') ? 'customer_cloudflare_r2' : 'customer_cloudflare_d1';

  try {
    const payload = await handler();
    const ok = payload.ok !== false;
    await logCustomerDataPlaneEvent(env, {
      user_id: userId,
      tenant_id: opts.tenant_id,
      workspace_id: workspaceId,
      data_plane,
      owner_type: 'customer',
      provider: 'cloudflare',
      operation_type: operation,
      success: ok,
      error_message: ok ? null : payload.error,
      duration_ms: Date.now() - t0,
      sql: opts.sql || opts.migration_sql,
      agent_run_id: opts.agent_run_id,
    });
    return { ...payload, ok, operation, data_plane, duration_ms: Date.now() - t0 };
  } catch (e) {
    await logCustomerDataPlaneEvent(env, {
      user_id: userId,
      tenant_id: opts.tenant_id,
      workspace_id: workspaceId,
      data_plane,
      operation_type: operation,
      success: false,
      error_message: e?.message ? String(e.message) : String(e),
      duration_ms: Date.now() - t0,
      agent_run_id: opts.agent_run_id,
    });
    return {
      ok: false,
      operation,
      data_plane,
      error: e?.message ? String(e.message) : String(e),
      duration_ms: Date.now() - t0,
    };
  }
}

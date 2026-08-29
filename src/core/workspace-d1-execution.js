/**
 * Workspace-scoped D1 execution for agentsam_d1_* (catalog handler_type cf, operation d1.*).
 *
 * Contract: Cloudflare REST only —
 *   POST /accounts/{account_id}/d1/database/{database_id}/query
 * account_id + token come from the caller's connected CF account (or platform token for operators).
 * Never Bindings MCP; never env.DB binding on the agent tool path.
 */
import { getDefaultWorkspaceDataBinding } from './workspace-data-bindings.js';
import { logDataPlaneSecurityEvent } from './data-plane-access-guard.js';
import {
  assertCallerOwnsDatabaseId,
  listOAuthAccountD1Catalog,
  resolveCallerD1ByNameOrId,
} from './cf-mcp-proxy.js';
import { getOAuthToken } from '../../backend/identity/oauth/user-token.js';
import { getAgentsamWorkspace, parseWorkspaceMetadata } from '../../backend/identity/workspace/agentsam-workspace.js';
import { resolveWorkspaceD1Catalog } from './workspace-d1-access.js';
import { slugNamedDatabaseIsNotPin } from './d1-list-workspace-annotate.js';

export const CUSTOMER_D1_NOT_CONFIGURED =
  'Connect Cloudflare (OAuth or BYOK) in Integrations, then pass database_id (UUID) from your account — list with agentsam_cf_d1_list. IAM platform D1 is operator-only.';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * Workspace default database_id from agentsam_workspace (convenience pin — not a gate).
 * @param {any} env
 * @param {string} workspaceId
 */
async function resolveWorkspacePinnedDatabaseId(env, workspaceId) {
  const ws = trim(workspaceId);
  if (!ws || !env?.DB) return '';
  const d1Binding = await getDefaultWorkspaceDataBinding(env, ws, 'cloudflare_d1');
  const fromBinding = trim(d1Binding?.external_database_id);
  if (fromBinding) return fromBinding;

  const row = await getAgentsamWorkspace(env, ws);
  const meta = parseWorkspaceMetadata(row?.metadata_json);
  const pinned = trim(row?.d1_database_id);
  if (pinned) return pinned;

  const arr = meta?.d1_databases;
  if (Array.isArray(arr) && arr[0] && typeof arr[0] === 'object') {
    const id = trim(arr[0].database_id);
    if (id) return id;
  }
  return '';
}

/**
 * Block the empty-stub trap: Cloudflare D1 named like the workspace slug
 * that is not the workspace pin.
 *
 * @param {any} env
 * @param {string} workspaceId
 * @param {string} requestedDatabaseId
 * @param {string} requestedDatabaseName
 */
async function denySlugNamedNonPin(env, workspaceId, requestedDatabaseId, requestedDatabaseName) {
  const ws = trim(workspaceId);
  if (!ws) return null;
  const pinned = await resolveWorkspacePinnedDatabaseId(env, ws);
  const row = await getAgentsamWorkspace(env, ws);
  const slug = trim(row?.workspace_slug);
  if (
    !slugNamedDatabaseIsNotPin({
      requestedDatabaseId,
      requestedDatabaseName,
      pinnedDatabaseId: pinned,
      workspaceSlug: slug,
    })
  ) {
    return null;
  }
  const catalog = resolveWorkspaceD1Catalog(row);
  const pinName =
    trim(catalog.find((e) => trim(e.database_id).toLowerCase() === pinned.toLowerCase())?.database_name) ||
    trim(catalog[0]?.database_name) ||
    pinned;
  return {
    ok: false,
    mode: 'denied',
    error: 'workspace_d1_slug_name_is_not_pin',
    user_message: `Database "${trim(requestedDatabaseName)}" matches the workspace slug but is not the workspace pin — that name is usually an empty stub. Use ${pinName} (${pinned}). Do not pick a D1 because its name equals the workspace slug.`,
    database_id: requestedDatabaseId,
    pinned_database_id: pinned,
    pinned_database_name: pinName,
  };
}

/**
 * Pair token + account_id for CF REST. Ownership already checked.
 * @param {any} env
 * @param {string} userId
 * @param {{
 *   token?: string|null,
 *   account_id?: string|null,
 *   database_id?: string|null,
 *   auth_scope?: string|null,
 * }} owned
 * @param {string} databaseId
 */
async function finalizeRemoteCredentials(env, userId, owned, databaseId) {
  let token = trim(owned?.token);
  if (!token && userId) {
    const { resolveUserCloudflareCredentials } = await import('./workspace-cloudflare-credentials.js');
    const cf = await resolveUserCloudflareCredentials(env, { user_id: userId });
    token = trim(cf.token);
  }
  if (!token) token = trim(env?.CLOUDFLARE_API_TOKEN);
  if (!token && userId) token = trim(await getOAuthToken(env, userId, 'cloudflare'));

  let accountId = trim(owned?.account_id) || trim(env?.CLOUDFLARE_ACCOUNT_ID);
  if (token && !accountId) {
    const catalog = await listOAuthAccountD1Catalog(token);
    accountId = trim(
      catalog.find((e) => e.database_id.toLowerCase() === databaseId.toLowerCase())?.account_id,
    );
  }

  if (!token || !accountId) {
    return {
      ok: false,
      error: token ? 'account_id_unresolved' : 'cloudflare_not_connected',
      user_message: CUSTOMER_D1_NOT_CONFIGURED,
      database_id: databaseId,
    };
  }

  return {
    ok: true,
    token,
    account_id: accountId,
    database_id: trim(owned?.database_id) || databaseId,
    auth_scope: owned?.auth_scope || null,
  };
}

/**
 * @param {string} token
 * @param {string} accountId
 * @param {string} databaseId
 * @param {string|Array<{ sql: string, params?: unknown[]|null }>} sqlOrStatements
 * @param {unknown[]} [params] — only when sqlOrStatements is a string
 */
export async function executeRemoteCloudflareD1Query(token, accountId, databaseId, sqlOrStatements, params = []) {
  const { buildCloudflareD1QueryBody } = await import('./d1-database-hint.js');
  const statements = Array.isArray(sqlOrStatements)
    ? sqlOrStatements
    : [{ sql: String(sqlOrStatements || ''), params: Array.isArray(params) ? params : [] }];
  const body = buildCloudflareD1QueryBody(statements);
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    const msg = data?.errors?.[0]?.message || `cloudflare_d1_query_${res.status}`;
    throw new Error(String(msg));
  }
  const results = Array.isArray(data?.result) ? data.result : data?.result != null ? [data.result] : [];
  const first = results[0] || {};
  return {
    rows: first?.results ?? first?.rows ?? [],
    meta: first?.meta ?? {},
    success: results.every((r) => r?.success !== false),
    batch: results.map((r) => ({
      rows: r?.results ?? r?.rows ?? [],
      meta: r?.meta ?? {},
      success: r?.success !== false,
    })),
    statement_count: statements.length,
  };
}

/**
 * Remote D1 write via the same Cloudflare REST /query endpoint (supports mutating SQL).
 * @param {string} token
 * @param {string} accountId
 * @param {string} databaseId
 * @param {string|Array<{ sql: string, params?: unknown[]|null }>} sqlOrStatements
 * @param {unknown[]} [params]
 */
export async function executeRemoteCloudflareD1Write(token, accountId, databaseId, sqlOrStatements, params = []) {
  const out = await executeRemoteCloudflareD1Query(token, accountId, databaseId, sqlOrStatements, params);
  const batch = Array.isArray(out.batch) ? out.batch : [];
  const changes = batch.reduce((n, r) => n + (Number(r.meta?.changes ?? 0) || 0), 0);
  const last = batch[batch.length - 1] || {};
  return {
    changes: changes || Number(out.meta?.changes ?? 0) || 0,
    last_row_id: last.meta?.last_row_id ?? out.meta?.last_row_id ?? null,
    meta: out.meta,
    rows: out.rows,
    success: out.success !== false,
    batch: out.batch,
    statement_count: out.statement_count,
  };
}

/**
 * Resolve account-scoped CF REST credentials for a D1 UUID (or catalog name).
 * Always returns mode: 'remote' on success — never platform env.DB.
 *
 * @param {any} env
 * @param {{
 *   user_id?: string|null,
 *   tenant_id?: string|null,
 *   workspace_id?: string|null,
 *   database?: string|null,
 *   database_name?: string|null,
 *   database_id?: string|null,
 *   authUser?: unknown,
 * }} ctx
 */
export async function resolveWorkspaceD1Execution(env, ctx) {
  const accountScoped = ctx?.account_scoped === true;
  const workspaceId = accountScoped
    ? ''
    : ctx?.workspace_id != null
      ? String(ctx.workspace_id).trim()
      : '';
  const userId = ctx?.user_id != null ? String(ctx.user_id).trim() : '';
  const tenantId = accountScoped
    ? ''
    : ctx?.tenant_id != null
      ? String(ctx.tenant_id).trim()
      : '';
  const nameHint = trim(ctx?.database || ctx?.database_name);
  let requestedDatabaseId = trim(ctx?.database_id);
  const pinnedDatabaseId = workspaceId ? await resolveWorkspacePinnedDatabaseId(env, workspaceId) : '';

  const meta = {
    user_id: userId || null,
    tenant_id: tenantId || null,
    provider: 'cloudflare_d1',
    pinned_database_id: pinnedDatabaseId || null,
  };
  const logMeta = { ...meta, workspace_id: workspaceId || null };

  if (nameHint || requestedDatabaseId) {
    const byName = await resolveCallerD1ByNameOrId(
      env,
      userId,
      { database: nameHint || null, database_id: requestedDatabaseId || null },
      ctx?.authUser,
    );
    if (!byName.ok) {
      return {
        ok: false,
        mode: 'denied',
        error: byName.error || 'database_not_in_account',
        user_message: byName.user_message || CUSTOMER_D1_NOT_CONFIGURED,
        available: byName.available || null,
        ...meta,
      };
    }
    requestedDatabaseId = trim(byName.database_id);
    meta.database_name = byName.database_name || nameHint || null;

    const slugDeny = await denySlugNamedNonPin(
      env,
      workspaceId,
      requestedDatabaseId,
      meta.database_name,
    );
    if (slugDeny) {
      return { ...slugDeny, user_id: meta.user_id, tenant_id: meta.tenant_id, provider: meta.provider };
    }

    const creds = await finalizeRemoteCredentials(env, userId, byName, requestedDatabaseId);
    if (!creds.ok) {
      return {
        ok: false,
        mode: 'denied',
        error: creds.error,
        user_message: creds.user_message,
        database_id: requestedDatabaseId,
        ...meta,
      };
    }

    const via =
      creds.auth_scope === 'platform_operator' ? 'platform_cf_rest' : 'user_oauth_cloudflare';
    logDataPlaneSecurityEvent(
      creds.auth_scope === 'platform_operator'
        ? 'platform_operator_d1_remote'
        : 'workspace_d1_user_account',
      {
        ...logMeta,
        database_id: creds.database_id,
        account_id: creds.account_id,
        auth_scope: creds.auth_scope || 'user_account',
        via,
      },
    );
    return {
      ok: true,
      mode: 'remote',
      token: creds.token,
      account_id: creds.account_id,
      database_id: creds.database_id,
      binding_id: null,
      via,
      ...meta,
    };
  }

  if (!userId) {
    return {
      ok: false,
      mode: 'denied',
      error: 'user_oauth_required',
      user_message: 'Sign in before using D1 tools.',
      ...meta,
    };
  }

  // Soft default only: session workspace pin (never a slug gate).
  const databaseId = pinnedDatabaseId;
  if (!databaseId) {
    return {
      ok: false,
      mode: 'denied',
      error: 'database_required',
      user_message:
        'Pass database_id (Cloudflare D1 UUID). List databases with agentsam_cf_d1_list after Cloudflare is connected in Integrations.',
      ...meta,
    };
  }

  const owned = await assertCallerOwnsDatabaseId(env, userId, databaseId, ctx?.authUser);
  if (!owned.ok) {
    return {
      ok: false,
      mode: 'denied',
      error: owned.error || 'database_id_not_in_account',
      user_message: owned.user_message || CUSTOMER_D1_NOT_CONFIGURED,
      database_id: databaseId,
      ...meta,
    };
  }

  const creds = await finalizeRemoteCredentials(env, userId, owned, databaseId);
  if (!creds.ok) {
    return {
      ok: false,
      mode: 'denied',
      error: creds.error,
      user_message: creds.user_message,
      database_id: databaseId,
      ...meta,
    };
  }

  const d1Binding = workspaceId
    ? await getDefaultWorkspaceDataBinding(env, workspaceId, 'cloudflare_d1')
    : null;

  logDataPlaneSecurityEvent('workspace_d1_user_account', {
    ...logMeta,
    database_id: creds.database_id,
    account_id: creds.account_id,
    auth_scope: creds.auth_scope || 'user_account',
    binding_id: d1Binding?.id ?? null,
    via: 'user_oauth_cloudflare',
  });

  return {
    ok: true,
    mode: 'remote',
    token: creds.token,
    account_id: creds.account_id,
    database_id: creds.database_id,
    binding_id: d1Binding?.id != null ? String(d1Binding.id) : null,
    via: 'user_oauth_cloudflare',
    ...meta,
  };
}

function toolFacingD1Meta(resolved) {
  const queried = trim(resolved?.database_id);
  const pinned = trim(resolved?.pinned_database_id);
  return {
    database_id: queried || null,
    database_name: resolved?.database_name || null,
    via: resolved?.via || 'cloudflare_rest',
    pinned_database_id: pinned || null,
    workspace_pin_mismatch: Boolean(pinned && queried && queried.toLowerCase() !== pinned.toLowerCase()),
  };
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} ctx
 * @param {string|Array<{ sql: string, params?: unknown[]|null }>} sqlOrStatements
 * @param {unknown[]} [params]
 */
export async function executeWorkspaceD1Query(env, ctx, sqlOrStatements, params = []) {
  const resolved = await resolveWorkspaceD1Execution(env, ctx);
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      user_message: resolved.user_message,
      pinned_database_id: resolved.pinned_database_id || null,
      database_id: resolved.database_id || null,
    };
  }

  if (resolved.mode !== 'remote' || !resolved.token || !resolved.account_id || !resolved.database_id) {
    return {
      ok: false,
      error: 'd1_rest_required',
      user_message:
        'D1 tools require Cloudflare REST credentials (token + account_id + database_id). Connect Cloudflare in Integrations.',
    };
  }

  const statements = Array.isArray(sqlOrStatements)
    ? sqlOrStatements
    : [{ sql: String(sqlOrStatements || ''), params: Array.isArray(params) ? params : [] }];

  const out = await executeRemoteCloudflareD1Query(
    resolved.token,
    resolved.account_id,
    resolved.database_id,
    statements,
  );
  return {
    ok: true,
    mode: 'remote',
    rows: out.rows || [],
    batch: out.batch,
    statement_count: out.statement_count,
    meta: toolFacingD1Meta(resolved),
  };
}

/**
 * Account-scoped D1 write via Cloudflare REST /query.
 * @param {any} env
 * @param {Record<string, unknown>} ctx
 * @param {string|Array<{ sql: string, params?: unknown[]|null }>} sqlOrStatements
 * @param {unknown[]} [params]
 */
export async function executeWorkspaceD1Write(env, ctx, sqlOrStatements, params = [], opts = {}) {
  const resolved = await resolveWorkspaceD1Execution(env, ctx);
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      user_message: resolved.user_message,
      pinned_database_id: resolved.pinned_database_id || null,
      database_id: resolved.database_id || null,
    };
  }

  if (resolved.mode !== 'remote' || !resolved.token || !resolved.account_id || !resolved.database_id) {
    return {
      ok: false,
      error: 'd1_rest_required',
      user_message:
        'D1 tools require Cloudflare REST credentials (token + account_id + database_id). Connect Cloudflare in Integrations.',
    };
  }

  const statements = Array.isArray(sqlOrStatements)
    ? sqlOrStatements
    : [{ sql: String(sqlOrStatements || ''), params: Array.isArray(params) ? params : [] }];

  const { gateD1WriteContracts, d1WriteContractBypassResponseFields } = await import(
    './d1-write-contract.js'
  );
  const bypassFlag = opts.allow_d1_contract_bypass ?? ctx?.allow_d1_contract_bypass;
  /** @type {Record<string, unknown>} */
  let contractBypass = {};
  for (const stmt of statements) {
    const contract = gateD1WriteContracts(stmt.sql, {
      allow_d1_contract_bypass: bypassFlag,
      env,
      workerCtx: opts.workerCtx ?? null,
      audit: ctx?.account_scoped
        ? {
            surface: opts.audit?.surface || 'catalog_cf_d1',
            tool_name: opts.audit?.tool_name || 'agentsam_d1_write',
          }
        : {
            surface: opts.audit?.surface || 'workspace_d1_write',
            tool_name: opts.audit?.tool_name || 'agentsam_d1_write',
            tenant_id: opts.audit?.tenant_id ?? ctx?.tenant_id ?? null,
            workspace_id: opts.audit?.workspace_id ?? ctx?.workspace_id ?? resolved.workspace_id ?? null,
            user_id: opts.audit?.user_id ?? ctx?.user_id ?? null,
            session_id: opts.audit?.session_id ?? ctx?.session_id ?? null,
            conversation_id: opts.audit?.conversation_id ?? ctx?.conversation_id ?? null,
          },
    });
    if (!contract.ok) {
      return {
        ok: false,
        error: contract.error,
        user_message: contract.error,
        contract: contract.contract,
      };
    }
    if (contract.bypass) {
      contractBypass = { ...contractBypass, ...d1WriteContractBypassResponseFields(contract) };
    }
  }

  const out = await executeRemoteCloudflareD1Write(
    resolved.token,
    resolved.account_id,
    resolved.database_id,
    statements,
  );
  return {
    ok: true,
    mode: 'remote',
    body: {
      changes: out.changes,
      last_row_id: out.last_row_id,
      success: out.success,
      batch: out.batch,
      statement_count: out.statement_count,
      ...contractBypass,
    },
    meta: toolFacingD1Meta(resolved),
    contract_bypass: contractBypass,
  };
}

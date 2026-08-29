/**
 * Cloudflare Bindings MCP proxy — account-level CF ops via connected user OAuth.
 * URL: https://bindings.mcp.cloudflare.com/mcp (streamable HTTP)
 *
 * Internal lanes (env.DB, R2 object CRUD, Vectorize) stay for gaps CF MCP does not cover.
 *
 * D1 ownership law: a UUID is allowed iff it appears in listOAuthAccountD1Catalog(token)
 * for the caller's connected credential. No hardcoded database UUID or role fallback.
 */

import { logDataPlaneSecurityEvent } from './data-plane-access-guard.js';

export const CF_BINDINGS_MCP_URL = 'https://bindings.mcp.cloudflare.com/mcp';
export const CF_BINDINGS_MCP_SERVER_KEY = 'cloudflare-bindings';

const D1_REMOTE_TOOLS_REQUIRING_OWNERSHIP = new Set([
  'd1_database_query',
  'd1_database_get',
  'd1_database_delete',
]);

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * List D1 databases visible to a Cloudflare OAuth/API token (all accounts on token).
 * Raw catalog — callers that need the visible list should use listCallerVisibleD1Databases.
 * @param {string} token
 * @returns {Promise<Array<{ database_id: string, database_name: string, account_id: string }>>}
 */
export async function listOAuthAccountD1Catalog(token) {
  const bearer = trim(token);
  if (!bearer) return [];
  const { cfApi } = await import('./customer-cloudflare-dispatch.js');
  const accounts = await cfApi(bearer, '/accounts');
  /** @type {Array<{ database_id: string, database_name: string, account_id: string }>} */
  const out = [];
  const seen = new Set();
  for (const acct of Array.isArray(accounts) ? accounts : []) {
    const accountId = trim(acct?.id);
    if (!accountId) continue;
    let databases = [];
    try {
      databases = await cfApi(
        bearer,
        `/accounts/${encodeURIComponent(accountId)}/d1/database`,
      );
    } catch {
      continue;
    }
    for (const db of Array.isArray(databases) ? databases : []) {
      const databaseId = trim(db?.uuid || db?.id);
      if (!databaseId) continue;
      const key = databaseId.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const fileSize = Number(db?.file_size);
      const numTables = Number(db?.num_tables);
      out.push({
        database_id: databaseId,
        database_name: trim(db?.name) || databaseId,
        account_id: accountId,
        file_size: Number.isFinite(fileSize) ? fileSize : null,
        num_tables: Number.isFinite(numTables) ? numTables : null,
        created_at: trim(db?.created_at) || null,
      });
    }
  }
  return out;
}

/**
 * ONE LAW (Studio + agentsam tools): D1 visibility is the caller's Cloudflare
 * credential catalog (OAuth/BYOK token). Operator may use env.CLOUDFLARE_API_TOKEN
 * only as a credential fallback to list — never inject a hardcoded database UUID.
 *
 * @param {any} env
 * @param {string|null|undefined} userId
 * @param {unknown} [authUser]
 * @returns {Promise<{
 *   databases: Array<{ database_id: string, database_name: string, account_id: string|null, source: string }>,
 *   operator: boolean,
 *   cloudflare_connected: boolean,
 *   token: string|null,
 *   credential_source: string|null,
 * }>}
 */
export async function listCallerVisibleD1Databases(env, userId, authUser = null) {
  const uid = trim(userId);
  /** @type {Array<{ database_id: string, database_name: string, account_id: string|null, source: string }>} */
  const out = [];
  const seen = new Set();

  let token = '';
  let credentialSource = null;
  if (uid) {
    try {
      const { resolveUserCloudflareCredentials } = await import('./workspace-cloudflare-credentials.js');
      const cf = await resolveUserCloudflareCredentials(env, { user_id: uid });
      token = trim(cf.token);
      credentialSource = cf.credential_source || null;
    } catch {
      token = '';
    }
  }
  if (token) {
    let catalog = [];
    try {
      catalog = await listOAuthAccountD1Catalog(token);
    } catch {
      catalog = [];
    }
    for (const entry of catalog) {
      const key = entry.database_id.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        database_id: entry.database_id,
        database_name: entry.database_name,
        account_id: entry.account_id,
        file_size: entry.file_size ?? null,
        num_tables: entry.num_tables ?? null,
        created_at: entry.created_at ?? null,
        source: 'user_account',
      });
    }
  }

  const { getOAuthToken } = await import('../../backend/identity/oauth/user-token.js');
  const oauth = uid ? await getOAuthToken(env, uid, 'cloudflare') : null;
  const cloudflareConnected = Boolean(oauth) || Boolean(token);

  return {
    databases: out,
    operator: false,
    cloudflare_connected: cloudflareConnected,
    token: token || null,
    credential_source: credentialSource,
  };
}

/**
 * @param {any} env
 * @param {unknown} authUser
 */
/**
 * Ownership: database_id must appear in the caller's CF account catalog under their token.
 * No Worker-secret fallback or hardcoded UUID deny/allow.
 *
 * @param {any} env
 * @param {string|null|undefined} userId
 * @param {string|null|undefined} databaseId
 * @param {unknown} [authUser]
 */
export async function assertCallerOwnsDatabaseId(env, userId, databaseId, authUser = null) {
  const dbId = trim(databaseId);
  if (!dbId) {
    return {
      ok: false,
      error: 'database_id_required',
      user_message: 'Pass database_id for this D1 operation, or list databases first.',
    };
  }

  const uid = trim(userId);
  if (!uid) {
    return {
      ok: false,
      error: 'user_oauth_required',
      user_message: 'Sign in before using Cloudflare D1 tools.',
    };
  }

  let token = '';
  let credentialSource = null;
  try {
    const { resolveUserCloudflareCredentials } = await import('./workspace-cloudflare-credentials.js');
    const cf = await resolveUserCloudflareCredentials(env, { user_id: uid });
    token = trim(cf.token);
    credentialSource = cf.credential_source || null;
  } catch {
    token = '';
  }
  if (!token) {
    return {
      ok: false,
      error: 'cloudflare_not_connected',
      reauth_required: true,
      user_message: 'Connect Cloudflare in Integrations (OAuth) before using D1 tools.',
    };
  }

  let catalog = [];
  try {
    catalog = await listOAuthAccountD1Catalog(token);
  } catch {
    catalog = [];
  }
  const match = catalog.find((e) => e.database_id.toLowerCase() === dbId.toLowerCase());
  if (!match) {
    logDataPlaneSecurityEvent('d1_database_not_in_caller_account', {
      user_id: uid,
      database_id: dbId,
      auth_scope: 'user_account',
      credential_source: credentialSource,
    });
    return {
      ok: false,
      error: 'database_id_not_in_account',
      user_message:
        'That D1 database is not in your connected Cloudflare account. List your databases and pick a valid database_id.',
      available: catalog.map((e) => e.database_name).filter(Boolean),
    };
  }

  logDataPlaneSecurityEvent(
    'workspace_d1_user_account',
    {
      user_id: uid,
      database_id: match.database_id,
      database_name: match.database_name || null,
      account_id: match.account_id,
      auth_scope: 'user_account',
      credential_source: credentialSource,
    },
  );

  return {
    ok: true,
    auth_scope: 'user_account',
    account_id: match.account_id,
    database_id: match.database_id,
    database_name: match.database_name || null,
    token,
  };
}

/**
 * Resolve plain CF D1 database name (or UUID) against the caller's account catalog.
 * Preferred targeting for agentsam_d1_* when an explicit name/UUID is passed —
 * not agentsam_workspace slug lookup. (Omit-UUID pin uses workspace.d1_database_id
 * elsewhere; that path does not call this.)
 *
 * @param {any} env
 * @param {string|null|undefined} userId
 * @param {{ database?: string|null, database_id?: string|null, database_name?: string|null }} hint
 * @param {unknown} [authUser]
 * @returns {Promise<{
 *   ok: boolean,
 *   database_id?: string,
 *   database_name?: string,
 *   account_id?: string|null,
 *   token?: string|null,
 *   auth_scope?: string,
 *   error?: string,
 *   user_message?: string,
 *   available?: string[],
 * }>}
 */
export async function resolveCallerD1ByNameOrId(env, userId, hint = {}, authUser = null) {
  const nameHint = trim(hint.database || hint.database_name || '');
  const idHint = trim(hint.database_id || '');
  if (!nameHint && !idHint) {
    return {
      ok: false,
      error: 'database_required',
      user_message: 'Pass database (Cloudflare D1 name) or database_id.',
    };
  }

  // UUID is canonical. When Studio sends both, a slug-named empty stub must not win.
  if (idHint) {
    const owned = await assertCallerOwnsDatabaseId(env, userId, idHint, authUser);
    if (!owned.ok) return owned;
    return {
      ok: true,
      database_id: owned.database_id || idHint,
      database_name: owned.database_name || nameHint || null,
      account_id: owned.account_id || null,
      token: owned.token || null,
      auth_scope: owned.auth_scope || null,
    };
  }

  const uid = trim(userId);
  if (!uid) {
    return {
      ok: false,
      error: 'user_oauth_required',
      user_message: 'Sign in before using Cloudflare D1 tools.',
    };
  }

  const { resolveUserCloudflareCredentials } = await import('./workspace-cloudflare-credentials.js');
  const cf = await resolveUserCloudflareCredentials(env, { user_id: uid });
  const token = trim(cf.token);
  const authScope = 'user_account';

  if (!token) {
    return {
      ok: false,
      error: 'cloudflare_token_missing',
      user_message:
        cf.user_message ||
        'No Cloudflare token available to list D1 databases. Connect Cloudflare OAuth.',
    };
  }

  // Law: account_id for this D1 comes from the catalog under THIS token — never workspace jail.
  const catalog = await listOAuthAccountD1Catalog(token);
  const available = catalog.map((e) => e.database_name).filter(Boolean);
  const needle = nameHint.toLowerCase();
  const match =
    catalog.find((e) => e.database_name.toLowerCase() === needle) ||
    (idHint
      ? catalog.find((e) => e.database_id.toLowerCase() === idHint.toLowerCase())
      : null);

  if (!match) {
    logDataPlaneSecurityEvent('d1_database_name_not_in_caller_account', {
      user_id: uid || null,
      database_name: nameHint || null,
      database_id: idHint || null,
      auth_scope: authScope,
      credential_source: cf.credential_source || null,
    });
    return {
      ok: false,
      error: 'database_not_in_account',
      user_message: nameHint
        ? `D1 database "${nameHint}" is not in your Cloudflare account. Available: ${available.slice(0, 20).join(', ') || '(none)'}.`
        : 'That D1 database is not in your Cloudflare account.',
      available,
    };
  }

  return {
    ok: true,
    database_id: match.database_id,
    database_name: match.database_name,
    account_id: match.account_id,
    token,
    auth_scope: authScope,
  };
}

/**
 * A tool routes through CF Bindings MCP only when explicitly opted in via:
 *   - server_key = 'cloudflare-bindings', OR
 *   - mcp_service_url contains 'bindings.mcp.cloudflare.com', OR
 *   - auth_source = 'user_oauth_cloudflare', OR
 *   - dispatch_target = 'mcp_proxy' AND an explicit remote_tool in handler_config
 *
 * provider=cloudflare alone is NOT sufficient — that flag predates CF MCP and
 * is set on all internal CF tools (D1, KV, R2 internal lanes). Without an
 * explicit remote_tool in handler_config, we never route to Bindings MCP.
 *
 * @param {Record<string, unknown>} row
 * @param {Record<string, unknown>} config
 */
export function isCfMcpCatalogTool(row, config) {
  const serverKey = trim(row?.server_key || config?.server_key);
  const mcpUrl = trim(row?.mcp_service_url || config?.mcp_service_url);
  const authSource = trim(config?.auth_source).toLowerCase();
  const dispatchTarget = trim(row?.dispatch_target || config?.dispatch_target).toLowerCase();
  const explicitRemoteTool = trim(config?.remote_tool);

  if (serverKey === CF_BINDINGS_MCP_SERVER_KEY) return true;
  if (mcpUrl.includes('bindings.mcp.cloudflare.com')) return true;
  if (authSource === 'user_oauth_cloudflare') return true;
  if (dispatchTarget === 'mcp_proxy' && explicitRemoteTool) return true;

  return false;
}

export function resolveCfMcpRemoteToolName(config, params = {}) {
  const explicit = trim(config?.remote_tool);
  if (explicit) return explicit;

  const op = trim(config?.operation || params?.operation || params?.op).toLowerCase();
  if (op === 'd1.query' || op === 'query') return 'd1_database_query';
  if (op === 'd1.write' || op === 'write') return 'd1_database_query';
  if (op === 'd1.databases' || op === 'd1.list') return 'd1_databases_list';
  if (op === 'workers.list') return 'workers_list';
  if (op === 'workers.get') return 'workers_get_worker';
  if (op === 'r2.buckets') return 'r2_buckets_list';
  if (op === 'kv.list') return 'kv_namespaces_list';
  // r2.list is object listing (agentsam_r2_list) — not Bindings MCP r2_buckets_list.
  void params;
  return trim(config?.operation);
}

/**
 * @param {Record<string, unknown>} row
 * @param {Record<string, unknown>} config
 * @returns {{ route: 'none'|'mcp_only'|'mcp_first', remoteTool: string, mcpRow: Record<string, unknown> }|null}\n */
export function resolveCfMcpCatalogRoute(row, config) {
  // First-party agentsam_d1_* always use account-scoped CF REST — never Bindings MCP.
  const toolKey = trim(row?.tool_key || row?.tool_name);
  if (/^agentsam_d1_(query|write|delete|migrate)$/i.test(toolKey)) return null;

  if (!isCfMcpCatalogTool(row, config)) return null;

  const dispatchTarget = trim(row?.dispatch_target || config?.dispatch_target || 'internal').toLowerCase();
  const handlerType = trim(row?.handler_type).toLowerCase();
  const remoteTool = resolveCfMcpRemoteToolName(config, {});
  if (!remoteTool) return null;

  if (dispatchTarget === 'internal' && handlerType !== 'mcp') return null;

  const route =
    dispatchTarget === 'mcp_proxy' || handlerType === 'mcp'
      ? 'mcp_only'
      : dispatchTarget === 'both'
        ? 'mcp_first'
        : 'none';

  if (route === 'none') return null;

  return {
    route,
    remoteTool,
    mcpRow: {
      tool_key: row.tool_key,
      tool_name: row.tool_name || row.tool_key,
      handler_config: JSON.stringify({
        ...(typeof config === 'object' && config ? config : {}),
        remote_tool: remoteTool,
        server_key: trim(row.server_key || config?.server_key) || CF_BINDINGS_MCP_SERVER_KEY,
      }),
      mcp_service_url: trim(row.mcp_service_url || config.mcp_service_url) || CF_BINDINGS_MCP_URL,
      server_key: trim(row.server_key || config.server_key) || CF_BINDINGS_MCP_SERVER_KEY,
    },
  };
}

/**
 * @param {any} env
 * @param {{ userId?: string|null, workspaceId?: string|null, tenantId?: string|null, authUser?: unknown }} ctx
 */
export async function resolveCfMcpBearerToken(env, ctx) {
  const { getOAuthToken } = await import('../../backend/identity/oauth/user-token.js');
  const userId = trim(ctx?.userId);
  if (!userId) {
    return {
      ok: false,
      error: 'user_oauth_required',
      user_message: 'Sign in and connect Cloudflare in Integrations before using CF MCP tools.',
    };
  }

  const oauth = await getOAuthToken(env, userId, 'cloudflare');
  if (oauth) {
    return { ok: true, token: oauth, source: 'user_oauth_cloudflare' };
  }

  return {
    ok: false,
    error: 'cloudflare_not_connected',
    reauth_required: true,
    user_message:
      'Connect Cloudflare Developer Platform in Settings → Integrations (OAuth).',
  };
}

/**
 * Map agentsam catalog params → Cloudflare Bindings MCP tool arguments.
 * Never invent a default database_id — caller must pass one (or workspace pin upstream).
 *
 * @param {string} remoteTool
 * @param {Record<string, unknown>} params
 * @param {Record<string, unknown>} config
 * @param {any} env
 */
export function mapAgentsamParamsToCfMcp(remoteTool, params, config, env) {
  const p = params && typeof params === 'object' ? params : {};
  const rt = trim(remoteTool);

  if (rt === 'd1_database_query') {
    // Hard CF contract: database_id UUID required — do not invent / soft-default names.
    // Bindings MCP is single-sql; multi queries[] uses our REST path (skip MCP).
    const databaseId = trim(p.database_id || p.databaseId);
    const q0 = Array.isArray(p.queries) && p.queries[0] && typeof p.queries[0] === 'object' ? p.queries[0] : null;
    return {
      database_id: databaseId,
      sql: trim(p.sql || p.query || q0?.sql),
      params: Array.isArray(p.params)
        ? p.params
        : Array.isArray(q0?.params)
          ? q0.params
          : p.params ?? null,
    };
  }

  if (rt === 'd1_databases_list') {
    return {};
  }

  if (rt === 'd1_database_get') {
    return {
      database_id: trim(p.database_id || p.databaseId),
    };
  }

  if (rt === 'workers_list') {
    return {};
  }

  if (rt === 'workers_get_worker') {
    return {
      script_name: trim(p.script_name || p.name || p.worker_name || p.scriptName),
    };
  }

  if (rt === 'workers_get_worker_code') {
    return {
      script_name: trim(p.script_name || p.name || p.worker_name || p.scriptName),
    };
  }

  if (rt === 'kv_namespaces_list') {
    return {};
  }

  if (rt === 'kv_namespace_get') {
    return { namespace_id: trim(p.namespace_id || p.namespaceId || p.id) };
  }

  if (rt === 'kv_namespace_create') {
    return { title: trim(p.title || p.name) };
  }

  if (rt === 'r2_buckets_list') {
    // Mirror Cloudflare Bindings MCP: no required args; optional list filters only.
    const out = {};
    const cursor = trim(p.cursor);
    const direction = trim(p.direction).toLowerCase();
    const nameContains = trim(p.name_contains || p.nameContains);
    const startAfter = trim(p.start_after || p.startAfter);
    const perPage = p.per_page ?? p.perPage;
    if (cursor) out.cursor = cursor;
    if (direction === 'asc' || direction === 'desc') out.direction = direction;
    if (nameContains) out.name_contains = nameContains;
    if (startAfter) out.start_after = startAfter;
    if (perPage != null && perPage !== '' && Number.isFinite(Number(perPage))) {
      out.per_page = Number(perPage);
    }
    return out;
  }

  if (rt === 'r2_bucket_get') {
    return { name: trim(p.name || p.bucket || p.bucket_name) };
  }

  if (rt === 'r2_bucket_create') {
    return { name: trim(p.name || p.bucket || p.bucket_name) };
  }

  return p;
}

/**
 * Resolve CF MCP bearer, map params, and enforce D1 database ownership before tools/call.
 *
 * @param {any} env
 * @param {{ userId?: string|null, workspaceId?: string|null, tenantId?: string|null, authUser?: unknown }} ctx
 * @param {string} remoteTool
 * @param {Record<string, unknown>} params
 * @param {Record<string, unknown>} config
 */
export async function prepareCfMcpCloudflareCall(env, ctx, remoteTool, params, config) {
  const tok = await resolveCfMcpBearerToken(env, ctx);
  if (!tok.ok || !tok.token) {
    return {
      ok: false,
      error: tok.error || 'cloudflare_not_connected',
      reauth_required: tok.reauth_required === true,
      user_message: tok.user_message,
    };
  }

  const mapped = mapAgentsamParamsToCfMcp(remoteTool, params, config, env);
  const rt = trim(remoteTool);

  if (D1_REMOTE_TOOLS_REQUIRING_OWNERSHIP.has(rt)) {
    const dbId = trim(mapped.database_id);
    if (!dbId) {
      return {
        ok: false,
        error: 'database_id_required',
        user_message: 'Pass database_id from your Cloudflare account (list databases first).',
      };
    }
    const owned = await assertCallerOwnsDatabaseId(env, ctx?.userId, dbId, ctx?.authUser);
    if (!owned.ok) {
      return {
        ok: false,
        error: owned.error,
        reauth_required: owned.reauth_required === true,
        user_message: owned.user_message,
      };
    }
  }

  return { ok: true, token: tok.token, params: mapped, token_source: tok.source };
}

/**
 * Bindings MCP streamable HTTP returns text/event-stream for tools/call.
 * Parse first `data:` JSON-RPC object (or bare JSON).
 * @param {string} raw
 * @returns {Record<string, unknown>}
 */
export function parseCfBindingsMcpResponseText(raw) {
  const text = String(raw || '').trim();
  if (!text) return {};
  if (text.startsWith('{')) {
    try {
      return JSON.parse(text);
    } catch {
      /* SSE fallback */
    }
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      return JSON.parse(payload);
    } catch {
      /* keep scanning */
    }
  }
  return { ok: false, error: 'cf_mcp_sse_parse_failed', raw_preview: text.slice(0, 240) };
}

/**
 * Normalize JSON-RPC tools/call result from Cloudflare MCP into agent-friendly body.
 * @param {unknown} jsonRpcBody
 */
export function normalizeCfMcpToolResultBody(jsonRpcBody) {
  if (!jsonRpcBody || typeof jsonRpcBody !== 'object') return jsonRpcBody;
  const rpc = /** @type {Record<string, unknown>} */ (jsonRpcBody);
  if (rpc.error && typeof rpc.error === 'object') {
    const err = /** @type {Record<string, unknown>} */ (rpc.error);
    return {
      ok: false,
      error: trim(err.message) || 'cf_mcp_error',
      code: err.code ?? null,
    };
  }

  const result = rpc.result;
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const r = /** @type {Record<string, unknown>} */ (result);
    if (r.structuredContent != null) return r.structuredContent;
    if (Array.isArray(r.content)) {
      const text = r.content
        .filter((c) => c && typeof c === 'object' && /** @type {any} */ (c).type === 'text')
        .map((c) => String(/** @type {any} */ (c).text || ''))
        .filter(Boolean)
        .join('\n');
      if (text) {
        try {
          return JSON.parse(text);
        } catch {
          return { text, mcp_content: r.content };
        }
      }
      return r;
    }
    return r;
  }

  return rpc;
}

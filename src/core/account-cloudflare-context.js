/**
 * Account-wide Cloudflare context — user OAuth / BYOK / platform env.
 * CF account id wins; persisted on user_settings (not per-workspace repeat OAuth).
 */
import { getIntegrationOAuthRow } from '../../backend/identity/oauth/user-token.js';
import { resolveIntegrationUserId } from '../../backend/identity/oauth/integration-user-id.js';
import { resolveWorkspaceCloudflareCredentials, maskAccountId } from './workspace-cloudflare-credentials.js';
import {
  looksLikeCfAccountId,
  resolveCfAccountFromAccessToken,
  healCloudflareOAuthAccountIfNeeded,
} from './cf-token-account.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function parseJson(raw, fallback = {}) {
  if (raw == null || raw === '') return { ...fallback };
  if (typeof raw === 'object') return raw;
  try {
    const o = JSON.parse(String(raw));
    return typeof o === 'object' && o !== null ? o : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function looksLikeCfAccountIdLocal(v) {
  return looksLikeCfAccountId(v);
}

function accountFromOAuthRow(row) {
  const fromIdentifier = trim(row?.account_identifier);
  if (looksLikeCfAccountIdLocal(fromIdentifier)) return fromIdentifier;
  const meta = parseJson(row?.metadata_json);
  return (
    trim(meta.cloudflare_account_id) ||
    trim(meta.account_id) ||
    trim(meta.cf_account_id) ||
    null
  );
}

/**
 * @param {any} env
 * @param {string} userId
 */
export async function readUserCfStackSettings(env, userId) {
  const uid = trim(userId);
  if (!env?.DB || !uid) return {};
  try {
    const row = await env.DB.prepare(`SELECT settings_json FROM user_settings WHERE user_id = ? LIMIT 1`)
      .bind(uid)
      .first();
    const prefs = parseJson(row?.settings_json);
    const stack =
      prefs.cf_stack && typeof prefs.cf_stack === 'object' ? prefs.cf_stack : prefs;
    return typeof stack === 'object' && stack !== null ? stack : {};
  } catch {
    return {};
  }
}

/**
 * Merge account-wide CF stack fields into user_settings.settings_json.
 * @param {any} env
 * @param {string} userId
 * @param {Record<string, unknown>} patch
 */
export async function persistUserCfStackSettings(env, userId, patch) {
  const uid = trim(userId);
  if (!env?.DB || !uid) return {};
  const row = await env.DB.prepare(`SELECT settings_json FROM user_settings WHERE user_id = ? LIMIT 1`)
    .bind(uid)
    .first();
  const prefs = parseJson(row?.settings_json);
  const current = prefs.cf_stack && typeof prefs.cf_stack === 'object' ? prefs.cf_stack : {};
  const nextStack = { ...current, ...patch };
  prefs.cf_stack = nextStack;
  for (const [k, v] of Object.entries(nextStack)) {
    if (k.startsWith('cf_')) prefs[k] = v;
  }
  const json = JSON.stringify(prefs);
  const now = Math.floor(Date.now() / 1000);
  const upd = await env.DB.prepare(
    `UPDATE user_settings SET settings_json = ?, updated_at = ? WHERE user_id = ?`,
  )
    .bind(json, now, uid)
    .run();
  if (!upd?.meta?.changes) {
    await env.DB.prepare(
      `INSERT INTO user_settings (id, user_id, settings_json, updated_at)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(`us_${uid.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40)}`, uid, json, now)
      .run()
      .catch(() => {});
  }
  return nextStack;
}

/**
 * @param {any} env
 * @param {import('../core/auth.js').AuthUser|null|undefined} authUser
 */
async function loadAuthUserRow(env, authUser) {
  const uid = trim(authUser?.id);
  if (!env?.DB || !uid) return authUser || null;
  if (authUser?.role != null || authUser?.is_superadmin != null) return authUser;
  try {
    return await env.DB.prepare(
      `SELECT id, 0 AS is_superadmin_removed, role FROM auth_users WHERE id = ? LIMIT 1`,
    )
      .bind(uid)
      .first();
  } catch {
    return authUser;
  }
}

/**
 * Resolve Cloudflare token + account for the signed-in user (account-wide).
 * @param {any} env
 * @param {{ userId?: string|null, tenantId?: string|null, workspaceId?: string|null, authUser?: import('../core/auth.js').AuthUser|null }} scope
 */
export async function resolveAccountCloudflareContext(env, scope = {}) {
  const authUser = scope.authUser || null;
  const userId =
    trim(scope.userId) ||
    (authUser?.id != null ? trim(authUser.id) : '') ||
    (authUser ? await resolveIntegrationUserId(env, authUser) : '');
  const tenantId = trim(scope.tenantId) || trim(authUser?.tenant_id);
  const workspaceId = trim(scope.workspaceId) || trim(authUser?.workspace_id);

  if (!env?.DB || !userId) {
    return {
      ok: false,
      error: 'missing_scope',
      token: null,
      account_id: null,
      account_mask: null,
      source: null,
      oauth_connected: false,
    };
  }

  const userCf = await readUserCfStackSettings(env, userId);
  let accountId = trim(userCf.cf_account_id) || null;

  const oauthRow = await getIntegrationOAuthRow(env, userId, 'cloudflare');
  let token = oauthRow?.access_token ? trim(oauthRow.access_token) : null;
  let oauthAccount = accountFromOAuthRow(oauthRow);
  if (token && !oauthAccount) {
    oauthAccount = await healCloudflareOAuthAccountIfNeeded(env, userId, token, oauthRow);
  }
  if (oauthAccount) accountId = oauthAccount;

  let source = token ? 'oauth' : null;

  if (!token && tenantId && workspaceId) {
    const byok = await resolveWorkspaceCloudflareCredentials(env, userId, tenantId, workspaceId);
    if (byok.ok && byok.token) {
      token = trim(byok.token);
      accountId = trim(byok.account_id) || accountId || null;
      source = 'byok';
    }
  }

  if (accountId && looksLikeCfAccountIdLocal(accountId) === false) accountId = null;

  return {
    ok: Boolean(token),
    error: token ? null : 'cloudflare_not_connected',
    token,
    account_id: accountId,
    account_mask: accountId ? maskAccountId(accountId) : null,
    source,
    oauth_connected: Boolean(oauthRow?.access_token),
    stack_settings: userCf,
  };
}

/**
 * Account-wide stack readiness — no per-workspace repeat once CF account is known.
 * @param {any} env
 * @param {{ userId?: string|null, tenantId?: string|null, workspaceId?: string|null, authUser?: import('../core/auth.js').AuthUser|null }} scope
 */
export async function isAccountCfStackReady(env, scope = {}) {
  const userId =
    trim(scope.userId) ||
    (scope.authUser?.id != null ? trim(scope.authUser.id) : '') ||
    (scope.authUser ? await resolveIntegrationUserId(env, scope.authUser) : '');
  const userCf = await readUserCfStackSettings(env, userId);
  if (Number(userCf.cf_stack_configured_at) > 0) return true;

  const ctx = await resolveAccountCloudflareContext(env, scope);
  if (!ctx.ok || !ctx.account_id) return false;

  if (ctx.source === 'platform') return true;
  if (ctx.oauth_connected && ctx.account_id) return true;
  if (ctx.source === 'byok' && ctx.account_id) return true;

  return Boolean(trim(userCf.cf_d1_database_id) || trim(userCf.cf_worker_name));
}

/**
 * JSON snapshot for dashboard wizards.
 * @param {any} env
 * @param {import('../core/auth.js').AuthUser} authUser
 */
export async function buildAccountCloudflareSnapshot(env, authUser) {
  const userId = await resolveIntegrationUserId(env, authUser);
  const tenantId = trim(authUser?.tenant_id);
  const workspaceId = trim(authUser?.workspace_id);
  const ctx = await resolveAccountCloudflareContext(env, {
    userId,
    tenantId,
    workspaceId,
    authUser,
  });
  const stackReady = await isAccountCfStackReady(env, { userId, tenantId, workspaceId, authUser });
  const stack = (ctx.stack_settings && typeof ctx.stack_settings === 'object' ? ctx.stack_settings : {}) || {};
  return {
    ok: ctx.ok,
    connected: ctx.ok,
    oauth_connected: ctx.oauth_connected,
    account_id: ctx.account_id,
    account_display: ctx.account_mask,
    stack_configured: stackReady,
    source: ctx.source,
    connect_url: '/api/integrations/cloudflare/connect',
    /** Account-wide CF stack prefs (user_settings) — not per-workspace. */
    stack,
    settings_json: stack,
  };
}

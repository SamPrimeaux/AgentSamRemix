/**
 * Cloudflare credentials — ONE account-wide spine (not per-workspace jail).
 *
 * Law:
 *   1. Resolve a validated token (OAuth → BYOK in user_secrets).
 *   2. Derive account_id from that token's /accounts list (preferred hint only if in scope).
 *   3. Workspace is soft org context only — never required to unlock CF utilities.
 *   4. D1 REST pairing (elsewhere): token → catalog → match.account_id for that database.
 *
 * Same law as MCP `resolveUserCloudflareCredentials` (inneranimalmedia-mcp-server).
 */
import { getDefaultWorkspaceDataBinding } from './workspace-data-bindings.js';
import {
  listCfAccountsForToken,
  looksLikeCfAccountId,
  healCloudflareOAuthAccountIfNeeded,
} from './cf-token-account.js';
import { getIntegrationOAuthRow } from '../../backend/identity/oauth/user-token.js';
import { decryptUserSecretPlaintext, parseSecretMetadata } from '../../backend/credentials/user-secret-store.js';

function parseMeta(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

function maskAccountId(accountId) {
  const s = String(accountId || '').trim();
  if (s.length <= 4) return '••••';
  return `••••${s.slice(-4)}`;
}

/**
 * BYOK Cloudflare token — user_secrets row (service_name=cloudflare).
 * @param {any} env
 * @param {string} userId
 */
async function loadCloudflareByokSecret(env, userId) {
  if (!env?.DB || !userId) return null;
  return env.DB.prepare(
    `SELECT id, secret_value_encrypted, metadata_json, service_name
       FROM user_secrets
      WHERE user_id = ?
        AND LOWER(COALESCE(service_name, '')) = 'cloudflare'
        AND COALESCE(is_active, 1) = 1
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1`,
  )
    .bind(userId)
    .first()
    .catch(() => null);
}
/**
 * Account id must come from the token's accessible accounts.
 * Soft hints (workspace / OAuth / BYOK meta) win only when they appear in that list.
 *
 * @param {string} token
 * @param {string|null|undefined} preferredAccountId
 */
export async function finalizeCloudflareAccountForToken(token, preferredAccountId = null) {
  const tok = trim(token);
  if (!tok) {
    return { ok: false, error: 'token_missing', account_id: null, account_id_source: null };
  }
  const listed = await listCfAccountsForToken(tok);
  if (!listed.ok || !listed.accounts?.length) {
    return {
      ok: false,
      error: listed.error || 'accounts_list_failed',
      account_id: null,
      account_id_source: null,
      accessible_accounts: listed.accounts || [],
    };
  }
  const preferred = trim(preferredAccountId);
  if (preferred && listed.accounts.some((a) => a.id.toLowerCase() === preferred.toLowerCase())) {
    return {
      ok: true,
      account_id: preferred,
      account_id_source: 'hint_verified_in_token_scope',
      accessible_accounts: listed.accounts,
    };
  }
  return {
    ok: true,
    account_id: listed.accounts[0].id,
    account_id_source: 'token_accounts_first',
    accessible_accounts: listed.accounts,
  };
}

/**
 * Soft org hint only — never used as REST account_id unless verified against the token.
 * @param {any} env
 * @param {string} workspaceId
 */
async function loadWorkspaceAccountHint(env, workspaceId) {
  const ws = trim(workspaceId);
  if (!ws || !env?.DB) return { accountId: null, bindingId: null };
  const accountBinding = await getDefaultWorkspaceDataBinding(env, ws, 'cloudflare');
  return {
    accountId: trim(accountBinding?.external_account_id) || null,
    bindingId: accountBinding?.id != null ? String(accountBinding.id) : null,
  };
}

/**
 * @param {any} env
 * @param {string} userId
 */
async function loadUserValidatedAccountHint(env, userId) {
  const uid = trim(userId);
  if (!uid || !env?.DB) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT settings_json FROM user_settings WHERE user_id = ? LIMIT 1`,
    )
      .bind(uid)
      .first();
    const prefs =
      row?.settings_json == null
        ? {}
        : typeof row.settings_json === 'object'
          ? row.settings_json
          : (() => {
              try {
                return JSON.parse(String(row.settings_json));
              } catch {
                return {};
              }
            })();
    const stack = prefs?.cf_stack && typeof prefs.cf_stack === 'object' ? prefs.cf_stack : prefs;
    const fromStack =
      trim(stack?.cf_account_id) ||
      trim(stack?.cloudflare_account_id) ||
      trim(prefs?.cf_account_id) ||
      trim(prefs?.cloudflare_account_id);
    if (fromStack) return fromStack;
  } catch (_) {
    /* ignore */
  }
  return null;
}

/**
 * Account-wide Cloudflare credentials. workspace_id is optional soft context only.
 *
 * @param {any} env
 * @param {{
 *   user_id?: string|null,
 *   tenant_id?: string|null,
 *   workspace_id?: string|null,
 * }} [scope]
 */
export async function resolveUserCloudflareCredentials(env, scope = {}) {
  const userId = trim(scope?.user_id);
  const tenantId = trim(scope?.tenant_id);
  const workspaceId = trim(scope?.workspace_id);
  const platformAccountId = trim(env?.CLOUDFLARE_ACCOUNT_ID);

  if (!userId) {
    return { ok: false, error: 'missing_user_id', token: null, account_id: null, key_id: null };
  }

  const { accountId: workspaceHint, bindingId } = await loadWorkspaceAccountHint(env, workspaceId);
  const userHint = await loadUserValidatedAccountHint(env, userId);
  const softPreferred = userHint || workspaceHint || platformAccountId || null;

  // Lane 1: Cloudflare OAuth (account-wide)
  const oauthRow = await getIntegrationOAuthRow(env, userId, 'cloudflare');
  const oauthToken = oauthRow?.access_token ? trim(oauthRow.access_token) : null;
  if (oauthToken) {
    let oauthHint = null;
    const fromId = trim(oauthRow?.account_identifier);
    if (looksLikeCfAccountId(fromId)) oauthHint = fromId;
    if (!oauthHint && oauthRow?.metadata_json) {
      try {
        const meta = JSON.parse(String(oauthRow.metadata_json));
        oauthHint = trim(meta?.cloudflare_account_id) || trim(meta?.account_id) || null;
      } catch {
        oauthHint = null;
      }
    }
    if (!oauthHint) {
      oauthHint = await healCloudflareOAuthAccountIfNeeded(env, userId, oauthToken, oauthRow);
    }
    const finalized = await finalizeCloudflareAccountForToken(
      oauthToken,
      oauthHint || softPreferred,
    );
    if (finalized.ok) {
      return {
        ok: true,
        error: null,
        token: oauthToken,
        account_id: finalized.account_id,
        account_mask: maskAccountId(finalized.account_id),
        account_id_source: finalized.account_id_source,
        key_id: null,
        binding_id: bindingId,
        scope: 'account',
        credential_source: 'oauth',
      };
    }
  }

  // Lane 4: BYOK — prefer workspace_id NULL
  if (!env?.DB) {
    return {
      ok: false,
      error: 'cloudflare_key_missing',
      token: null,
      account_id: null,
      key_id: null,
      binding_id: bindingId,
    };
  }

  const row = await loadCloudflareByokSecret(env, userId);
  if (!row) {
    return {
      ok: false,
      error: 'cloudflare_key_missing',
      token: null,
      account_id: null,
      key_id: null,
      binding_id: bindingId,
      user_message:
        'Connect Cloudflare in Settings → Integrations (OAuth) or Keys (account-wide BYOK). Workspace is not required.',
    };
  }

  const meta = parseSecretMetadata(row);
  const byokHint =
    trim(meta.cloudflare_account_id) || trim(meta.account_id) || softPreferred || null;
  const token = await decryptUserSecretPlaintext(env, {
    userId,
    tenantId,
    secretId: String(row.id),
  });
  const tokenStr = typeof token === 'string' ? token : null;
  if (!tokenStr) {
    return {
      ok: false,
      error: 'cloudflare_token_decrypt_failed',
      token: null,
      account_id: null,
      key_id: row.id != null ? String(row.id) : null,
      binding_id: bindingId,
    };
  }

  const finalized = await finalizeCloudflareAccountForToken(tokenStr, byokHint);
  if (!finalized.ok) {
    return {
      ok: false,
      error: finalized.error || 'cloudflare_account_id_missing',
      token: null,
      account_id: null,
      key_id: row.id != null ? String(row.id) : null,
      binding_id: bindingId,
      accessible_accounts: finalized.accessible_accounts || null,
    };
  }

  return {
    ok: true,
    error: null,
    token: String(tokenStr),
    account_id: finalized.account_id,
    account_mask: maskAccountId(finalized.account_id),
    account_id_source: finalized.account_id_source,
    key_id: row.id != null ? String(row.id) : null,
    binding_id: bindingId,
    scope: 'account',
    credential_source: 'byok',
  };
}

/**
 * Compatibility wrapper — workspace_id is soft context, not a gate.
 * Callers that only have userId still succeed.
 *
 * @param {any} env
 * @param {string} userId
 * @param {string} [tenantId]
 * @param {string} [workspaceId]
 */
export async function resolveWorkspaceCloudflareCredentials(env, userId, tenantId, workspaceId) {
  if (!userId) {
    return { ok: false, error: 'missing_scope', token: null, account_id: null, key_id: null };
  }
  return resolveUserCloudflareCredentials(env, {
    user_id: userId,
    tenant_id: tenantId,
    workspace_id: workspaceId,
  });
}

export { maskAccountId };

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * Cloudflare connected for user tools — OAuth refresh via CLOUDFLARE_OAUTH_CLIENT_* then BYOK.
 * @param {any} env
 * @param {string|null|undefined} userId
 * @param {string|null|undefined} [workspaceId]
 */
export async function resolveCloudflareUserConnection(env, userId, workspaceId = null) {
  const uid = trim(userId);
  if (!uid) return { connected: false, source: null, account_id: null };

  const { resolveCloudflareOAuthToken } = await import('../../backend/identity/oauth/user-token.js');
  const oauth = await resolveCloudflareOAuthToken(env, uid, { nearExpirySeconds: 300 });
  if (oauth.ok) {
    return {
      connected: true,
      source: 'oauth',
      account_id: oauth.accountId || null,
    };
  }

  const creds = await resolveUserCloudflareCredentials(env, {
    user_id: uid,
    workspace_id: workspaceId,
  });
  if (creds.ok && creds.token) {
    return {
      connected: true,
      source: creds.credential_source || 'byok',
      account_id: creds.account_id || null,
    };
  }

  return { connected: false, source: null, account_id: null };
}

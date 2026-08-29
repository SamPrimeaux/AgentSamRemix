/**
 * Resolve Cloudflare account_id from an OAuth access token or BYOK API token.
 * GET /client/v4/accounts — CF token responses do not include account_id.
 * In-memory cache keyed by token hash (request/isolate lifetime only).
 */

const CF_API = 'https://api.cloudflare.com/client/v4';

/** @type {Map<string, { id: string, name: string, accounts: Array<{ id: string, name: string }> }|null>} */
const accountCache = new Map();

function trim(v) {
  return v == null ? '' : String(v).trim();
}

export function looksLikeCfAccountId(v) {
  const s = trim(v);
  return /^[a-f0-9]{32}$/i.test(s);
}

async function tokenCacheKey(token) {
  const data = new TextEncoder().encode(String(token || ''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {string} token
 */
export async function listCfAccountsForToken(token) {
  const tok = trim(token);
  if (!tok) return { ok: false, error: 'token_missing', accounts: [] };

  const res = await fetch(`${CF_API}/accounts`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${tok}` },
  }).catch((e) => ({ ok: false, status: 0, _err: e }));

  if (!res?.ok) {
    return {
      ok: false,
      error: 'accounts_list_http_failed',
      status: res?.status ?? 0,
      accounts: [],
      detail: res?._err?.message || null,
    };
  }

  const data = await res.json().catch(() => ({}));
  if (!data?.success) {
    return {
      ok: false,
      error: 'accounts_list_failed',
      accounts: [],
      cf_errors: data?.errors || null,
    };
  }

  const accounts = (Array.isArray(data.result) ? data.result : [])
    .map((row) => ({ id: trim(row?.id), name: trim(row?.name) }))
    .filter((row) => row.id);

  return { ok: true, accounts };
}

/**
 * Primary account for token — first accessible account unless preferred id matches.
 * @param {string} token
 * @param {{ preferred_account_id?: string }} [opts]
 * @returns {Promise<{ id: string, name: string, accounts: Array<{ id: string, name: string }> }|null>}
 */
export async function resolveCfAccountFromAccessToken(token, opts = {}) {
  const tok = trim(token);
  if (!tok) return null;

  const cacheKey = await tokenCacheKey(tok);
  if (accountCache.has(cacheKey)) {
    return accountCache.get(cacheKey) ?? null;
  }

  const list = await listCfAccountsForToken(tok);
  if (!list.ok || !list.accounts.length) {
    accountCache.set(cacheKey, null);
    return null;
  }

  const preferred = trim(opts.preferred_account_id);
  const pick =
    (preferred && list.accounts.find((a) => a.id === preferred)) || list.accounts[0];
  const resolved = {
    id: pick.id,
    name: pick.name,
    accounts: list.accounts,
  };
  accountCache.set(cacheKey, resolved);
  return resolved;
}

/**
 * @param {string} token
 * @param {{ preferred_account_id?: string }} [opts]
 */
export async function resolveCfAccountIdFromToken(token, opts = {}) {
  const account = await resolveCfAccountFromAccessToken(token, opts);
  if (!account?.id) {
    return { ok: false, error: 'cloudflare_account_id_unresolvable', account_id: null };
  }
  return { ok: true, account_id: account.id, account_name: account.name || null };
}

/**
 * Self-heal bad CF OAuth rows (e.g. account_identifier = "Cloudflare" app name).
 * @param {any} env
 * @param {string} userId
 * @param {string} accessToken
 * @param {Record<string, unknown>|null|undefined} oauthRow
 */
export async function healCloudflareOAuthAccountIfNeeded(env, userId, accessToken, oauthRow = null) {
  const uid = trim(userId);
  const token = trim(accessToken);
  if (!env?.DB || !uid || !token) return null;

  const fromId = trim(oauthRow?.account_identifier);
  if (looksLikeCfAccountId(fromId)) return fromId;
  if (oauthRow?.metadata_json) {
    try {
      const meta = JSON.parse(String(oauthRow.metadata_json));
      const fromMeta = trim(meta?.cloudflare_account_id) || trim(meta?.account_id);
      if (looksLikeCfAccountId(fromMeta)) return fromMeta;
    } catch {
      /* ignore */
    }
  }

  const resolved = await resolveCfAccountFromAccessToken(token);
  if (!resolved?.id) {
    console.warn('[cf_oauth_heal] accounts list empty or failed', { user_id: uid });
    return null;
  }

  const meta = JSON.stringify({ cloudflare_account_id: resolved.id });
  const now = Math.floor(Date.now() / 1000);
  try {
    await env.DB.prepare(
      `UPDATE user_oauth_tokens
          SET account_identifier = ?,
              account_display = COALESCE(?, account_display),
              metadata_json = ?,
              updated_at = ?
        WHERE user_id = ?
          AND LOWER(provider) = 'cloudflare'`,
    )
      .bind(resolved.id, resolved.name || null, meta, now, uid)
      .run();
  } catch (e) {
    console.warn('[cf_oauth_heal] row patch failed', e?.message || e);
  }

  try {
    const { persistUserCfStackSettings } = await import('./account-cloudflare-context.js');
    await persistUserCfStackSettings(env, uid, { cf_account_id: resolved.id });
  } catch (e) {
    console.warn('[cf_oauth_heal] cf_stack patch failed', e?.message || e);
  }

  return resolved.id;
}

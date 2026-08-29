/**
 * Resolve OAuth tokens from D1 user_oauth_tokens with vault-id → encrypted → plaintext order,
 * optional Google refresh, and persistence after refresh.
 */
import {
  decryptWithVault,
  encryptWithVault,
  ensureOauthTokenColumns,
  upsertOauthToken,
} from './token-store.js';
import { isVaultConfigured } from '../../credentials/vault-key-material.js';

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Resolve a stored OAuth access token without provider routing.
 * Kept in this leaf so integrations never import the HTTP OAuth controller.
 */
export async function resolveOAuthAccessToken(env, row) {
  if (!row) return null;
  if (row.access_token_encrypted) {
    try {
      const dec = await decryptWithVault(env, row.access_token_encrypted);
      if (dec) return dec;
    } catch (e) {
      console.warn('[user-oauth-token] decrypt access_token failed:', e?.message);
    }
  }
  return row.access_token || null;
}

/** Resolve a stored OAuth refresh token without provider routing. */
export async function resolveOAuthRefreshToken(env, row) {
  if (!row) return null;
  if (row.refresh_token_encrypted) {
    try {
      const dec = await decryptWithVault(env, row.refresh_token_encrypted);
      if (dec) return dec;
    } catch (e) {
      console.warn('[user-oauth-token] decrypt refresh_token failed:', e?.message);
    }
  }
  return row.refresh_token || null;
}

/**
 * Flip is_active → 0 with an error code (honest liveness).
 * @param {any} env
 * @param {string} userId
 * @param {string} provider
 * @param {string} accountIdentifier
 * @param {string} code
 */
export async function markOAuthTokenInactive(env, userId, provider, accountIdentifier, code) {
  if (!env?.DB || !userId || !provider) return;
  const cols = await pragmaColumns(env.DB, 'user_oauth_tokens');
  if (!cols.has('is_active')) return;
  const sets = ['is_active = 0'];
  const binds = [];
  if (cols.has('updated_at')) sets.push('updated_at = unixepoch()');
  if (cols.has('last_refresh_at')) sets.push('last_refresh_at = unixepoch()');
  if (cols.has('last_refresh_error_code')) {
    sets.push('last_refresh_error_code = ?');
    binds.push(String(code || 'INACTIVE').slice(0, 120));
  }
  if (cols.has('refresh_failure_count')) {
    sets.push('refresh_failure_count = COALESCE(refresh_failure_count, 0) + 1');
  }
  binds.push(String(userId), mapIncomingProvider(provider), accountIdentifier != null ? String(accountIdentifier) : '');
  await env.DB.prepare(
    `UPDATE user_oauth_tokens SET ${sets.join(', ')}
     WHERE user_id = ? AND provider = ? AND account_identifier = ?
       AND COALESCE(is_active, 1) = 1`,
  )
    .bind(...binds)
    .run()
    .catch(() => {});
}

/**
 * Repair TEXT ISO values written into INTEGER updated_at (calendar sync footgun).
 * @param {any} env
 * @returns {Promise<number>} rows changed
 */
export async function normalizeOAuthUpdatedAtText(env) {
  if (!env?.DB) return 0;
  const r = await env.DB.prepare(
    `UPDATE user_oauth_tokens
     SET updated_at = CAST(strftime('%s', updated_at) AS INTEGER)
     WHERE typeof(updated_at) = 'text'
       AND length(trim(updated_at)) >= 10
       AND CAST(strftime('%s', updated_at) AS INTEGER) > 1000000000`,
  ).run();
  return Number(r?.meta?.changes ?? r?.changes ?? 0) || 0;
}

async function pragmaColumns(DB, tableName) {
  const out = await DB.prepare(`PRAGMA table_info(${tableName})`).all();
  const cols = new Set();
  for (const row of out.results || []) cols.add(String(row.name || '').toLowerCase());
  return cols;
}

/** Map API aliases to provider column values in user_oauth_tokens. */
function mapIncomingProvider(provider) {
  const raw = String(provider || '').trim();
  const p = raw.toLowerCase();
  if (p === 'google' || p === 'gdrive' || p === 'google_drive') return 'google_drive';
  if (p === 'gmail' || p === 'google_gmail') return 'google_gmail';
  if (p === 'google_calendar' || p === 'gcal') return 'google_calendar';
  if (p === 'github') return 'github';
  return raw;
}

function googleOAuthClientSecret(env) {
  const a = typeof env?.GOOGLE_OAUTH_CLIENT_SECRET === 'string' ? env.GOOGLE_OAUTH_CLIENT_SECRET.trim() : '';
  if (a) return a;
  const b = typeof env?.GOOGLE_CLIENT_SECRET === 'string' ? env.GOOGLE_CLIENT_SECRET.trim() : '';
  return b;
}

/** Google OAuth integrations that use oauth2.googleapis.com refresh with a refresh_token. */
function isGoogleOAuthRefreshProvider(provider) {
  const p = String(provider || '').toLowerCase();
  if (p === 'google_drive' || p === 'gmail' || p === 'google_gmail' || p === 'google_calendar') return true;
  if (p.startsWith('google_')) return true;
  return false;
}

async function decryptFromVaultSecretId(env, userId, secretId) {
  if (!secretId || !env?.DB) return null;
  const row = await env.DB.prepare(
    `SELECT secret_value_encrypted FROM user_secrets WHERE id = ? AND user_id = ? AND is_active = 1 LIMIT 1`,
  )
    .bind(String(secretId), String(userId))
    .first();
  if (!row?.secret_value_encrypted) return null;
  try {
    return await decryptWithVault(env, row.secret_value_encrypted);
  } catch {
    return null;
  }
}

async function resolveAccessToken(env, userId, row, cols) {
  if (cols.has('vault_access_token_id') && row.vault_access_token_id) {
    const t = await decryptFromVaultSecretId(env, userId, row.vault_access_token_id);
    if (t) return t;
  }
  if (row.access_token_encrypted && isVaultConfigured(env)) {
    const t = await decryptWithVault(env, row.access_token_encrypted).catch(() => null);
    if (t) return t;
  }
  return row.access_token || null;
}

async function resolveRefreshToken(env, userId, row, cols) {
  if (cols.has('vault_refresh_token_id') && row.vault_refresh_token_id) {
    const t = await decryptFromVaultSecretId(env, userId, row.vault_refresh_token_id);
    if (t) return t;
  }
  if (row.refresh_token_encrypted && isVaultConfigured(env)) {
    const t = await decryptWithVault(env, row.refresh_token_encrypted).catch(() => null);
    if (t) return t;
  }
  return row.refresh_token || null;
}

async function fetchOAuthRow(env, userId, provider, accountIdentifier, opts = {}) {
  const DB = env.DB;
  const cols = await pragmaColumns(DB, 'user_oauth_tokens');
  const parts = ['provider', 'account_identifier', 'expires_at'];
  if (cols.has('updated_at')) parts.push('updated_at');
  if (cols.has('tenant_id')) parts.push('tenant_id');
  if (cols.has('person_uuid')) parts.push('person_uuid');
  if (cols.has('access_token')) parts.push('access_token');
  if (cols.has('refresh_token')) parts.push('refresh_token');
  if (cols.has('access_token_encrypted')) parts.push('access_token_encrypted');
  if (cols.has('refresh_token_encrypted')) parts.push('refresh_token_encrypted');
  if (cols.has('vault_access_token_id')) parts.push('vault_access_token_id');
  if (cols.has('vault_refresh_token_id')) parts.push('vault_refresh_token_id');
  if (cols.has('scope')) parts.push('scope');
  if (cols.has('scopes')) parts.push('scopes');
  if (cols.has('metadata_json')) parts.push('metadata_json');
  if (cols.has('account_display')) parts.push('account_display');
  if (cols.has('is_active')) parts.push('is_active');
  if (cols.has('revoked_at')) parts.push('revoked_at');
  if (cols.has('revoked_by')) parts.push('revoked_by');
  if (cols.has('last_refresh_at')) parts.push('last_refresh_at');
  if (cols.has('last_refresh_error_code')) parts.push('last_refresh_error_code');
  if (cols.has('refresh_failure_count')) parts.push('refresh_failure_count');

  const prov = mapIncomingProvider(provider);
  const aid = accountIdentifier != null ? String(accountIdentifier) : '';
  const activeWhere = opts.includeInactive
    ? ''
    : `${cols.has('is_active') ? ' AND COALESCE(is_active, 1) = 1' : ''}${
        cols.has('revoked_at') ? ' AND revoked_at IS NULL' : ''
      }`;
  // updated_at must be integer unix; tolerate legacy TEXT ISO from calendar sync.
  const updatedOrder = cols.has('updated_at')
    ? `COALESCE(CASE WHEN typeof(updated_at)='integer' THEN updated_at ELSE CAST(strftime('%s', updated_at) AS INTEGER) END, 0)`
    : '0';

  let row;
  if (prov === 'cloudflare' && aid === '') {
    row = await DB.prepare(
      `SELECT ${parts.join(', ')} FROM user_oauth_tokens
       WHERE user_id = ? AND provider = 'cloudflare'
       ${activeWhere}
       ORDER BY ${updatedOrder} DESC LIMIT 1`,
    )
      .bind(String(userId))
      .first();
  } else if (prov === 'github' && aid === '') {
    row = await DB.prepare(
      `SELECT ${parts.join(', ')} FROM user_oauth_tokens
       WHERE user_id = ? AND provider IN ('github','github_app')
       ${activeWhere}
       ORDER BY ${updatedOrder} DESC LIMIT 1`,
    )
      .bind(String(userId))
      .first();
  } else if (prov === 'google_drive' && aid === '') {
    // Drive rows may use account_identifier '' (canonical) or legacy email keys.
    row = await DB.prepare(
      `SELECT ${parts.join(', ')} FROM user_oauth_tokens
       WHERE user_id = ? AND provider IN ('google_drive','google')
       ${activeWhere}
       ORDER BY CASE WHEN account_identifier = '' THEN 0 ELSE 1 END,
                ${updatedOrder} DESC
       LIMIT 1`,
    )
      .bind(String(userId))
      .first();
  } else if ((prov === 'google_gmail' || prov === 'gmail') && aid === '') {
    row = await DB.prepare(
      `SELECT ${parts.join(', ')} FROM user_oauth_tokens
       WHERE user_id = ? AND lower(provider) IN ('google_gmail','gmail')
       ${activeWhere}
       ORDER BY ${updatedOrder} DESC
       LIMIT 1`,
    )
      .bind(String(userId))
      .first();
  } else if (prov === 'google_gmail' || prov === 'gmail') {
    row = await DB.prepare(
      `SELECT ${parts.join(', ')} FROM user_oauth_tokens
       WHERE user_id = ? AND lower(provider) IN ('google_gmail','gmail')
         AND lower(account_identifier) = lower(?)
       ${activeWhere}
       ORDER BY ${updatedOrder} DESC
       LIMIT 1`,
    )
      .bind(String(userId), aid)
      .first();
  } else {
    row = await DB.prepare(
      `SELECT ${parts.join(', ')} FROM user_oauth_tokens
       WHERE user_id = ? AND provider = ? AND account_identifier = ?
       ${activeWhere}
       ORDER BY ${updatedOrder} DESC LIMIT 1`,
    )
      .bind(String(userId), prov, aid)
      .first();
  }
  return { row, cols };
}

/**
 * Refresh Cloudflare OAuth access token (requires refresh_token from offline_access grant).
 * @returns {Promise<object|null>}
 */
export async function refreshCloudflareAccessToken(env, refreshToken) {
  if (!env?.CLOUDFLARE_OAUTH_CLIENT_ID || !env?.CLOUDFLARE_OAUTH_CLIENT_SECRET || !refreshToken) {
    return null;
  }
  const basic = btoa(`${env.CLOUDFLARE_OAUTH_CLIENT_ID}:${env.CLOUDFLARE_OAUTH_CLIENT_SECRET}`);
  const res = await fetch('https://dash.cloudflare.com/oauth2/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: String(refreshToken),
    }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) return null;
  return data;
}

async function recordCloudflareRefreshFailure(env, userId, accountIdentifier, cols, code) {
  const sets = [];
  const binds = [];
  // Refresh failure = not live. Do not leave decorative is_active=1.
  if (cols.has('is_active')) sets.push('is_active = 0');
  if (cols.has('last_refresh_at')) sets.push('last_refresh_at = unixepoch()');
  if (cols.has('last_refresh_error_code')) {
    sets.push('last_refresh_error_code = ?');
    binds.push(code);
  }
  if (cols.has('refresh_failure_count')) {
    sets.push('refresh_failure_count = COALESCE(refresh_failure_count, 0) + 1');
  }
  if (cols.has('updated_at')) sets.push('updated_at = unixepoch()');
  if (!sets.length) return;
  binds.push(String(userId), String(accountIdentifier || ''));
  await env.DB.prepare(
    `UPDATE user_oauth_tokens SET ${sets.join(', ')}
     WHERE user_id = ? AND provider = 'cloudflare' AND account_identifier = ?`,
  )
    .bind(...binds)
    .run()
    .catch(() => {});
}

/**
 * Refresh and atomically persist a Cloudflare OAuth credential using the canonical vault format.
 * Provider details never escape this function; callers receive stable error codes only.
 */
export async function refreshAndPersistCloudflareToken(env, userId, row, cols) {
  const accountIdentifier = String(row?.account_identifier || '');
  const refreshToken = await resolveRefreshToken(env, userId, row, cols);
  if (!refreshToken) {
    const code = 'REFRESH_TOKEN_MISSING';
    await recordCloudflareRefreshFailure(env, userId, accountIdentifier, cols, code);
    return { ok: false, code };
  }
  if (!env?.CLOUDFLARE_OAUTH_CLIENT_ID || !env?.CLOUDFLARE_OAUTH_CLIENT_SECRET) {
    const code = 'REFRESH_NOT_CONFIGURED';
    await recordCloudflareRefreshFailure(env, userId, accountIdentifier, cols, code);
    return { ok: false, code };
  }

  let token;
  try {
    token = await refreshCloudflareAccessToken(env, refreshToken);
  } catch {
    token = null;
  }
  if (!token?.access_token) {
    const code = 'PROVIDER_REFRESH_FAILED';
    await recordCloudflareRefreshFailure(env, userId, accountIdentifier, cols, code);
    return { ok: false, code };
  }

  const nextRefresh = token.refresh_token || refreshToken;
  let encryptedAccess = null;
  let encryptedRefresh = null;
  if (cols.has('access_token_encrypted')) {
    if (!isVaultConfigured(env)) {
      const code = 'TOKEN_ENCRYPTION_UNAVAILABLE';
      await recordCloudflareRefreshFailure(env, userId, accountIdentifier, cols, code);
      return { ok: false, code };
    }
    try {
      encryptedAccess = await encryptWithVault(env, token.access_token);
      if (nextRefresh && cols.has('refresh_token_encrypted')) {
        encryptedRefresh = await encryptWithVault(env, nextRefresh);
      }
    } catch {
      const code = 'TOKEN_ENCRYPTION_FAILED';
      await recordCloudflareRefreshFailure(env, userId, accountIdentifier, cols, code);
      return { ok: false, code };
    }
  }

  const expiry = nowSeconds() + (Number(token.expires_in) || 3600);
  const sets = [];
  const binds = [];
  if (cols.has('access_token')) {
    sets.push('access_token = ?');
    binds.push(token.access_token);
  }
  if (cols.has('access_token_encrypted')) {
    sets.push('access_token_encrypted = ?');
    binds.push(encryptedAccess);
  }
  if (cols.has('refresh_token')) {
    sets.push('refresh_token = ?');
    binds.push(nextRefresh);
  }
  if (cols.has('refresh_token_encrypted')) {
    sets.push('refresh_token_encrypted = ?');
    binds.push(encryptedRefresh);
  }
  sets.push('expires_at = ?');
  binds.push(expiry);
  if (cols.has('last_refresh_at')) sets.push('last_refresh_at = unixepoch()');
  if (cols.has('last_refresh_error_code')) sets.push('last_refresh_error_code = NULL');
  if (cols.has('refresh_failure_count')) sets.push('refresh_failure_count = 0');
  if (cols.has('is_active')) sets.push('is_active = 1');
  if (cols.has('updated_at')) sets.push('updated_at = unixepoch()');

  binds.push(String(userId), accountIdentifier);
  const persisted = await env.DB.prepare(
    `UPDATE user_oauth_tokens SET ${sets.join(', ')}
     WHERE user_id = ? AND provider = 'cloudflare' AND account_identifier = ?
       ${cols.has('revoked_at') ? 'AND revoked_at IS NULL' : ''}`,
  )
    .bind(...binds)
    .run()
    .catch(() => null);
  if (!persisted?.meta?.changes) {
    return { ok: false, code: 'TOKEN_STATE_CHANGED' };
  }
  return {
    ok: true,
    accessToken: token.access_token,
    refreshToken: nextRefresh,
    expiresAt: expiry,
  };
}

/**
 * Persist refreshed Google access token to D1 (access_token, access_token_encrypted, expires_at).
 * @returns {Promise<string|null>} New access token or null on failure.
 */
export async function refreshGoogleToken(env, userId, provider, refreshToken, row) {
  const clientSecret = googleOAuthClientSecret(env);
  if (!env?.GOOGLE_CLIENT_ID || !clientSecret || !refreshToken) return null;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  const newToken = data.access_token;
  if (!newToken) return null;
  const newExpiry = nowSeconds() + (Number(data.expires_in) || 3600);

  if (!env?.DB) return newToken;

  const cols = await pragmaColumns(env.DB, 'user_oauth_tokens');
  const accountId = row?.account_identifier != null ? String(row.account_identifier) : '';

  let encrypted = null;
  if (cols.has('access_token_encrypted') && isVaultConfigured(env)) {
    encrypted = await encryptWithVault(env, newToken).catch(() => null);
  }

  const sets = [];
  const binds = [];
  if (cols.has('access_token')) {
    sets.push('access_token = ?');
    binds.push(newToken);
  }
  if (cols.has('access_token_encrypted')) {
    sets.push('access_token_encrypted = ?');
    binds.push(encrypted);
  }
  sets.push('expires_at = ?');
  binds.push(newExpiry);
  if (cols.has('is_active')) sets.push('is_active = 1');
  if (cols.has('last_refresh_error_code')) sets.push('last_refresh_error_code = NULL');
  if (cols.has('refresh_failure_count')) sets.push('refresh_failure_count = 0');
  if (cols.has('last_refresh_at')) sets.push('last_refresh_at = unixepoch()');
  if (cols.has('updated_at')) sets.push('updated_at = unixepoch()');

  binds.push(String(userId), mapIncomingProvider(provider), accountId);

  await env.DB.prepare(
    `UPDATE user_oauth_tokens SET ${sets.join(', ')}
     WHERE user_id = ? AND provider = ? AND account_identifier = ?`,
  )
    .bind(...binds)
    .run();

  return newToken;
}

/**
 * Full OAuth row with decrypted access_token and refresh_token (after refresh when applicable).
 * @param {string} [accountIdentifier] — GitHub multi-account login; use '' for default / Drive root row.
 */
export async function getIntegrationOAuthRow(env, userId, provider, accountIdentifier = '') {
  if (!env?.DB || !userId || !provider) return null;

  const { resolveIntegrationUserId } = await import('./integration-user-id.js');
  const canonicalUserId =
    (await resolveIntegrationUserId(env, { id: String(userId).trim() })) || String(userId).trim();

  const { row, cols } = await fetchOAuthRow(env, canonicalUserId, provider, accountIdentifier);
  if (!row) return null;

  const prov = mapIncomingProvider(provider);
  const accountKey =
    row.account_identifier != null ? String(row.account_identifier) : String(accountIdentifier || '');
  let accessToken = await resolveAccessToken(env, canonicalUserId, row, cols);
  let refreshToken = await resolveRefreshToken(env, canonicalUserId, row, cols);

  const exp =
    row.expires_at != null && row.expires_at !== '' ? Number(row.expires_at) : null;
  const now = nowSeconds();
  const isExpired = exp != null && Number.isFinite(exp) && exp < now;

  if (isExpired && isGoogleOAuthRefreshProvider(prov) && refreshToken) {
    const newAccess = await refreshGoogleToken(env, canonicalUserId, prov, refreshToken, row);
    if (newAccess) accessToken = newAccess;
    else {
      await markOAuthTokenInactive(env, canonicalUserId, prov, accountKey, 'PROVIDER_REFRESH_FAILED');
      return null;
    }
  } else if (isExpired && isGoogleOAuthRefreshProvider(prov) && !refreshToken) {
    await markOAuthTokenInactive(env, canonicalUserId, prov, accountKey, 'REFRESH_TOKEN_MISSING');
    return null;
  } else if (
    isExpired &&
    !isGoogleOAuthRefreshProvider(prov) &&
    prov !== 'cloudflare' &&
    prov !== 'github'
  ) {
    // other providers with hard expiry and no refresh path in this resolver
    if (!refreshToken) {
      await markOAuthTokenInactive(
        env,
        canonicalUserId,
        prov,
        accountKey,
        'ACCESS_EXPIRED_NO_REFRESH',
      );
      return null;
    }
  }

  // Cloudflare OAuth (~24h access) — refresh when offline_access issued a refresh_token.
  const needsCfRefresh =
    prov === 'cloudflare' &&
    refreshToken &&
    (isExpired || (exp != null && Number.isFinite(exp) && exp <= now + 300));
  if (needsCfRefresh) {
    const refreshed = await refreshAndPersistCloudflareToken(
      env,
      canonicalUserId,
      row,
      cols,
    );
    if (refreshed.ok) {
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
      return {
        ...row,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: refreshed.expiresAt ?? row.expires_at,
        is_active: 1,
        last_refresh_error_code: null,
        provider: prov,
      };
    }
    return null;
  } else if (prov === 'cloudflare' && isExpired && !refreshToken) {
    await markOAuthTokenInactive(
      env,
      canonicalUserId,
      prov,
      accountKey,
      'ACCESS_EXPIRED_NO_REFRESH',
    );
    return null;
  }

  return {
    ...row,
    access_token: accessToken,
    refresh_token: refreshToken,
    provider: prov,
  };
}

function cloudflareAccountId(row) {
  try {
    const meta = JSON.parse(String(row?.metadata_json || '{}'));
    const fromMeta = String(meta?.cloudflare_account_id || '').trim();
    if (/^[a-f0-9]{32}$/i.test(fromMeta)) return fromMeta;
  } catch {
    // Fall through to the canonical account_identifier.
  }
  const identifier = String(row?.account_identifier || '').trim();
  return /^[a-f0-9]{32}$/i.test(identifier) ? identifier : null;
}

/**
 * Resolve an active Cloudflare OAuth token for the internal MCP bridge.
 * This is the only resolver that exposes lifecycle failure reasons; public callers use
 * getIntegrationOAuthRow(), which filters inactive/revoked rows to null.
 */
export async function resolveCloudflareOAuthToken(
  env,
  userId,
  { tenantId = '', accountIdentifier = '', nearExpirySeconds = 300 } = {},
) {
  if (!env?.DB || !userId) return { ok: false, code: 'INVALID_REQUEST' };
  const { resolveIntegrationUserId } = await import('./integration-user-id.js');
  const canonicalUserId =
    (await resolveIntegrationUserId(env, { id: String(userId).trim() })) || '';
  if (!canonicalUserId) return { ok: false, code: 'IDENTITY_NOT_FOUND' };

  const { row, cols } = await fetchOAuthRow(
    env,
    canonicalUserId,
    'cloudflare',
    accountIdentifier,
    { includeInactive: true },
  );
  if (!row) return { ok: false, code: 'TOKEN_NOT_FOUND' };
  if (cols.has('is_active') && Number(row.is_active) === 0) {
    return { ok: false, code: 'TOKEN_INACTIVE' };
  }
  if (cols.has('revoked_at') && row.revoked_at != null && Number(row.revoked_at) !== 0) {
    return { ok: false, code: 'TOKEN_REVOKED' };
  }

  const expectedTenant = String(tenantId || '').trim();
  const storedTenant = String(row.tenant_id || '').trim();
  if (expectedTenant && storedTenant && expectedTenant !== storedTenant) {
    return { ok: false, code: 'TENANT_MISMATCH' };
  }

  let accessToken = await resolveAccessToken(env, canonicalUserId, row, cols);
  const expiry = row.expires_at != null && row.expires_at !== ''
    ? Number(row.expires_at)
    : null;
  const now = nowSeconds();
  const refreshWindow = Math.max(0, Number(nearExpirySeconds) || 0);
  const needsRefresh =
    !accessToken ||
    (expiry != null && Number.isFinite(expiry) && expiry <= now + refreshWindow);
  let refreshed = false;
  let resolvedExpiry = expiry;

  if (needsRefresh) {
    const result = await refreshAndPersistCloudflareToken(env, canonicalUserId, row, cols);
    if (!result.ok) return result;
    accessToken = result.accessToken;
    resolvedExpiry = result.expiresAt;
    refreshed = true;
  }
  if (!accessToken) return { ok: false, code: 'TOKEN_UNAVAILABLE' };

  return {
    ok: true,
    canonicalUserId,
    tenantId: storedTenant || expectedTenant || null,
    accessToken,
    accountId: cloudflareAccountId(row),
    scopes: String(row.scopes || row.scope || '')
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean),
    expiresAt: Number.isFinite(resolvedExpiry) ? resolvedExpiry : null,
    refreshed,
  };
}

/** Returns the decrypted access token string only (same resolution + refresh as integrations). */
export async function getOAuthToken(env, userId, provider, accountIdentifier = '') {
  const row = await getIntegrationOAuthRow(env, userId, provider, accountIdentifier);
  return row?.access_token ?? null;
}

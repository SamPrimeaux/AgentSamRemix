/**
 * D1 owns canonical app user ids (auth_users.id). Supabase Auth UUID lives in auth_users.supabase_user_id only.
 */
import { resolveAuthUserByEmail, upsertAuthUserEmail } from '../../backend/identity/users/index.js';
import { isD1OverloadError, withD1Retry } from '../database/d1/retry.js';

const ENSURE_USER_KV_TTL = 60 * 60 * 24 * 30;

function ensureUserKvKeyEmail(email) {
  return `auth:ensure:email:${String(email || '').toLowerCase().trim()}`;
}

function ensureUserKvKeyProvider(provider, providerUid) {
  return `auth:ensure:provider:${String(provider || '').trim()}:${String(providerUid || '').trim()}`;
}

async function readEnsureUserKvCache(env, { email, provider, providerUid }) {
  if (!env?.SESSION_CACHE) return null;
  const keys = [];
  if (email) keys.push(ensureUserKvKeyEmail(email));
  if (provider && providerUid) keys.push(ensureUserKvKeyProvider(provider, providerUid));
  for (const key of keys) {
    try {
      const raw = await env.SESSION_CACHE.get(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed?.authUserId) return parsed;
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function writeEnsureUserKvCache(env, { email, provider, providerUid }, payload) {
  if (!env?.SESSION_CACHE || !payload?.authUserId) return;
  const json = JSON.stringify(payload);
  const puts = [];
  if (email) {
    puts.push(
      env.SESSION_CACHE.put(ensureUserKvKeyEmail(email), json, { expirationTtl: ENSURE_USER_KV_TTL }),
    );
  }
  if (provider && providerUid) {
    puts.push(
      env.SESSION_CACHE.put(ensureUserKvKeyProvider(provider, providerUid), json, {
        expirationTtl: ENSURE_USER_KV_TTL,
      }),
    );
  }
  await Promise.all(puts).catch(() => {});
}

function resultFromRow(row, created) {
  if (!row?.id && !row?.authUserId) return null;
  const authUserId = String(row.authUserId || row.id);
  return {
    authUserId,
    row: row.row || row,
    created: !!created,
  };
}

/**
 * @returns {string} e.g. au_ + 16 hex chars (8 random bytes)
 */
export function generateAppUserId() {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `au_${hex}`;
}

async function d1First(env, sql, ...params) {
  return withD1Retry(() => env.DB.prepare(sql).bind(...params).first());
}

async function d1Run(env, sql, ...params) {
  return withD1Retry(() => env.DB.prepare(sql).bind(...params).run());
}

/**
 * @param {*} env
 * @param {{ email: string, name?: string, supabaseUserId?: string|null, provider?: string, provider_uid?: string, passwordHash?: string, salt?: string, source?: string }} identity
 * @param {{ allowCreate?: boolean }} options
 */
async function ensureAppUserFromD1(env, identity, options) {
  const allowCreate = options.allowCreate !== false;
  const email = String(identity.email || '').toLowerCase().trim();
  const name = String(identity.name || email.split('@')[0] || 'User').trim();
  const supabaseUserId =
    identity.supabaseUserId != null && String(identity.supabaseUserId).trim()
      ? String(identity.supabaseUserId).trim()
      : '';
  const provider = identity.provider != null ? String(identity.provider).trim() : '';
  const providerUid =
    identity.provider_uid != null
      ? String(identity.provider_uid).trim()
      : identity.providerUid != null
        ? String(identity.providerUid).trim()
        : '';
  const hasPassword = identity.passwordHash !== undefined && identity.salt !== undefined;

  if (supabaseUserId) {
    const bySb = await d1First(
      env,
      `SELECT id, email, name, tenant_id, supabase_user_id FROM auth_users WHERE supabase_user_id = ? LIMIT 1`,
      supabaseUserId,
    );
    if (bySb?.id) {
      return resultFromRow(bySb, false);
    }
  }

  if (provider && providerUid) {
    const byProvider = await d1First(
      env,
      `SELECT account_id FROM account_identities WHERE provider = ? AND provider_subject = ? LIMIT 1`,
      provider,
      providerUid,
    );
    if (byProvider?.account_id) {
      const accountId = String(byProvider.account_id);
      const row = await d1First(
        env,
        `SELECT id, email, name, tenant_id, supabase_user_id FROM auth_users WHERE id = ? LIMIT 1`,
        accountId,
      );
      if (row?.id) {
        const id = String(row.id);
        if (supabaseUserId) {
          const stored = row.supabase_user_id != null ? String(row.supabase_user_id).trim() : '';
          if (!stored) {
            await d1Run(
              env,
              `UPDATE auth_users SET supabase_user_id = ?, updated_at = datetime('now') WHERE id = ?`,
              supabaseUserId,
              id,
            );
          } else if (stored !== supabaseUserId) {
            console.error(
              '[ensureAppUser] account_identities row supabase_user_id does not match JWT subject',
            );
            return null;
          }
        }
        const refreshed = await d1First(
          env,
          `SELECT id, email, name, tenant_id, supabase_user_id FROM auth_users WHERE id = ? LIMIT 1`,
          id,
        );
        return resultFromRow(refreshed || row, false);
      }
    }
  }

  const byEmail = await withD1Retry(() => resolveAuthUserByEmail(env, email));

  if (byEmail?.id) {
    const id = String(byEmail.id);
    if (supabaseUserId) {
      const stored = byEmail.supabase_user_id != null ? String(byEmail.supabase_user_id).trim() : '';
      if (!stored) {
        await d1Run(
          env,
          `UPDATE auth_users SET supabase_user_id = ?, updated_at = datetime('now') WHERE id = ?`,
          supabaseUserId,
          id,
        );
      } else if (stored !== supabaseUserId) {
        console.error('[ensureAppUser] Existing row supabase_user_id does not match JWT subject');
        return null;
      }
    }

    const row = await d1First(
      env,
      `SELECT id, email, name, tenant_id, supabase_user_id FROM auth_users WHERE id = ? LIMIT 1`,
      id,
    );

    return resultFromRow(row || byEmail, false);
  }

  if (!allowCreate) return null;

  const id = generateAppUserId();
  const passwordHash = hasPassword ? identity.passwordHash : 'oauth';
  const salt = hasPassword ? identity.salt : 'oauth';

  const localPart = email.split('@')[0].toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  const tenantId = 'tenant_' + (localPart || crypto.randomUUID().slice(0, 8));
  const userKey = localPart || crypto.randomUUID().slice(0, 8);
  const workspaceId = 'ws_' + userKey;

  await d1Run(
    env,
    `INSERT INTO auth_users (id, email, name, password_hash, salt, supabase_user_id, tenant_id, user_key, default_workspace_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    id,
    email,
    name,
    passwordHash,
    salt,
    supabaseUserId || null,
    tenantId,
    userKey,
    workspaceId,
  );

  await withD1Retry(() =>
    upsertAuthUserEmail(env, {
      authUserId: id,
      email,
      kind: 'primary',
      tenantId,
      isLoginEnabled: true,
    }),
  );

  const row = await d1First(
    env,
    `SELECT id, email, name, tenant_id, supabase_user_id FROM auth_users WHERE id = ? LIMIT 1`,
    id,
  );

  return resultFromRow(row, true);
}

/**
 * Find or create auth_users row. Never uses Supabase's UUID as auth_users.id.
 *
 * @param {*} env
 * @param {{ email: string, name?: string, supabaseUserId?: string|null, provider?: string, provider_uid?: string, passwordHash?: string, salt?: string, source?: string }} identity
 * @param {{ allowCreate?: boolean }} [options]
 * @returns {Promise<{ authUserId: string, row: object|null, created: boolean, fromCache?: boolean }|null>}
 */
export async function ensureAppUser(env, identity, options = {}) {
  const email = String(identity.email || '').toLowerCase().trim();
  const provider = identity.provider != null ? String(identity.provider).trim() : '';
  const providerUid =
    identity.provider_uid != null
      ? String(identity.provider_uid).trim()
      : identity.providerUid != null
        ? String(identity.providerUid).trim()
        : '';

  if (!env?.DB || !email) return null;

  try {
    const result = await ensureAppUserFromD1(env, identity, options);
    if (result?.authUserId) {
      await writeEnsureUserKvCache(
        env,
        { email, provider, providerUid },
        {
          authUserId: result.authUserId,
          email,
          tenant_id: result.row?.tenant_id ?? null,
          name: result.row?.name ?? null,
          supabase_user_id: result.row?.supabase_user_id ?? null,
        },
      );
    }
    return result;
  } catch (e) {
    console.warn('[ensureAppUser]', e?.message ?? e);
    if (isD1OverloadError(e) || String(e?.message || '').includes('D1')) {
      const cached = await readEnsureUserKvCache(env, { email, provider, providerUid });
      if (cached?.authUserId) {
        console.warn('[ensureAppUser] using KV cache during D1 overload', cached.authUserId);
        return {
          authUserId: String(cached.authUserId),
          row: {
            id: String(cached.authUserId),
            email: cached.email || email,
            name: cached.name || null,
            tenant_id: cached.tenant_id ?? null,
            supabase_user_id: cached.supabase_user_id ?? null,
          },
          created: false,
          fromCache: true,
        };
      }
    }
    return null;
  }
}

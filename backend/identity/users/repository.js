/**
 * Single resolver: email / au_* id → auth_users row.
 * auth_user_emails is checked first; auth_users.email is transitional fallback.
 */

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function normalizeEmail(raw) {
  return trim(raw).toLowerCase();
}

function authUserEmailId() {
  return `aue_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

const AUTH_USER_SELECT = `
  SELECT id, email, name, display_name, tenant_id, person_uuid, role,
         0 AS is_superadmin_removed,
         account_type, identity_label,
         COALESCE(iam_owned, 0) AS iam_owned,
         COALESCE(downgrade_protected, 0) AS downgrade_protected,
         default_workspace_id, active_workspace_id, active_tenant_id,
         password_hash, salt, status, supabase_user_id, user_key
    FROM auth_users`;

/**
 * @param {any} env
 * @param {string} authUserId
 */
export async function loadAuthUserById(env, authUserId) {
  const id = trim(authUserId);
  if (!id || !env?.DB) return null;
  try {
    return await env.DB.prepare(`${AUTH_USER_SELECT} WHERE id = ? LIMIT 1`).bind(id).first();
  } catch {
    return null;
  }
}

/**
 * Resolve authorized user by login email (auth_user_emails → auth_users.email).
 * @param {any} env
 * @param {string} rawEmail
 * @returns {Promise<(Record<string, unknown> & { resolved_via?: string, email_kind?: string })|null>}
 */
export async function resolveAuthUserByEmail(env, rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!email || !env?.DB) return null;

  try {
    const alias = await env.DB.prepare(
      `SELECT auth_user_id, kind, iam_owned
         FROM auth_user_emails
        WHERE LOWER(email) = ?
          AND COALESCE(is_login_enabled, 1) = 1
        LIMIT 1`,
    )
      .bind(email)
      .first();

    if (alias?.auth_user_id) {
      const row = await loadAuthUserById(env, String(alias.auth_user_id));
      if (row) {
        return {
          ...row,
          resolved_via: 'auth_user_emails',
          email_kind: trim(alias.kind) || 'primary',
        };
      }
    }
  } catch (e) {
    console.warn('[resolveAuthUserByEmail] alias lookup:', e?.message ?? e);
  }

  try {
    const row = await env.DB.prepare(`${AUTH_USER_SELECT} WHERE LOWER(email) = ? LIMIT 1`)
      .bind(email)
      .first();
    if (row) return { ...row, resolved_via: 'auth_users.email', email_kind: 'primary' };
  } catch {
    return null;
  }
  return null;
}

/**
 * Email or au_* id lookup.
 * @param {any} env
 * @param {string} key
 */
export async function resolveAuthUserLookup(env, key) {
  const k = trim(key);
  if (!k) return null;
  if (k.toLowerCase().startsWith('au_')) {
    const row = await loadAuthUserById(env, k);
    return row ? { ...row, resolved_via: 'auth_users.id', email_kind: 'primary' } : null;
  }
  return resolveAuthUserByEmail(env, k);
}

/** @param {object|null|undefined} row */
export function isIamOwnedIdentity(row) {
  return Number(row?.iam_owned || 0) === 1;
}

/**
 * IAM-owned service/agent identity (e.g. ai@inneranimalmedia.com).
 * @param {object|null|undefined} row
 */
export function isIamServiceIdentity(row) {
  if (!isIamOwnedIdentity(row)) return false;
  const t = trim(row?.account_type).toLowerCase();
  return t === 'agent' || t === 'service' || t === 'system';
}

/**
 * Full-catalog MCP lane for IAM service identities with downgrade protection.
 * @param {object|null|undefined} row
 */
export function isIamServiceIdentityLane(row) {
  return isIamServiceIdentity(row) && Number(row?.downgrade_protected || 0) === 1;
}

/**
 * Customer signup must not reuse IAM-owned emails.
 * @param {any} env
 * @param {string} email
 */
export async function isIamOwnedEmail(env, email) {
  const normalized = normalizeEmail(email);
  if (!normalized || !env?.DB) return false;
  try {
    const row = await env.DB.prepare(
      `SELECT 1 FROM auth_user_emails
        WHERE LOWER(email) = ? AND COALESCE(iam_owned, 0) = 1
        LIMIT 1`,
    )
      .bind(normalized)
      .first();
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Upsert primary email row after auth_users create/update.
 * @param {any} env
 * @param {{
 *   authUserId: string,
 *   email: string,
 *   personUuid?: string|null,
 *   kind?: string,
 *   label?: string|null,
 *   cfAccountId?: string|null,
 *   tenantId?: string|null,
 *   iamOwned?: boolean,
 *   isLoginEnabled?: boolean,
 * }} opts
 */
export async function upsertAuthUserEmail(env, opts) {
  if (!env?.DB) return false;
  const authUserId = trim(opts.authUserId);
  const email = normalizeEmail(opts.email);
  if (!authUserId || !email) return false;

  const personUuid = trim(opts.personUuid) || null;
  const kind = trim(opts.kind) || 'primary';
  const tenantId = trim(opts.tenantId) || null;
  const iamOwned = opts.iamOwned ? 1 : 0;
  const isLoginEnabled = opts.isLoginEnabled === false ? 0 : 1;

  try {
    const existing = await env.DB.prepare(
      `SELECT id FROM auth_user_emails WHERE LOWER(email) = ? LIMIT 1`,
    )
      .bind(email)
      .first();

    if (existing?.id) {
      await env.DB.prepare(
        `UPDATE auth_user_emails
            SET auth_user_id = ?,
                person_uuid = COALESCE(?, person_uuid),
                kind = COALESCE(NULLIF(?, ''), kind),
                label = COALESCE(?, label),
                cf_account_id = COALESCE(?, cf_account_id),
                tenant_id = COALESCE(?, tenant_id),
                iam_owned = MAX(iam_owned, ?),
                is_login_enabled = ?,
                updated_at = unixepoch()
          WHERE id = ?`,
      )
        .bind(
          authUserId,
          personUuid,
          kind,
          trim(opts.label) || null,
          trim(opts.cfAccountId) || null,
          tenantId,
          iamOwned,
          isLoginEnabled,
          existing.id,
        )
        .run();
      return true;
    }

    await env.DB.prepare(
      `INSERT INTO auth_user_emails
         (id, email, auth_user_id, person_uuid, kind, label, cf_account_id, tenant_id,
          is_verified, is_login_enabled, iam_owned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, unixepoch(), unixepoch())`,
    )
      .bind(
        authUserEmailId(),
        email,
        authUserId,
        personUuid,
        kind,
        trim(opts.label) || null,
        trim(opts.cfAccountId) || null,
        tenantId,
        isLoginEnabled,
        iamOwned,
      )
      .run();
    return true;
  } catch (e) {
    console.warn('[upsertAuthUserEmail]', e?.message ?? e);
    return false;
  }
}

/**
 * Canonical BYOK persistence — user_secrets only (no user_api_keys / user_storage_access_keys).
 */
import { aesGcmEncryptToB64, getAESKey } from './crypto-vault.js';
import { decryptWithVault } from '../identity/oauth/token-store.js';
import { maskAccountId } from '../../src/core/workspace-cloudflare-credentials.js';
import {
  BYOK_USER_SCOPE,
  PERSONAL_SERVICE_NAME,
  PROVIDERS,
  R2_SECRET_NAME,
  R2_SERVICE_NAME,
  providerSecretName,
} from './provider-catalog.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function nowIso() {
  return new Date().toISOString();
}

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function parseJsonSafe(v, fallback = {}) {
  if (v == null || v === '') return fallback;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(String(v));
  } catch {
    return fallback;
  }
}

function lastFourOfSecret(value) {
  const s = String(value || '');
  if (s.length < 4) return '????';
  return s.slice(-4);
}

export function newSecretId() {
  return `sec_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
}

/** @param {any} db */
export async function userSecretsColumns(db) {
  try {
    const res = await db.prepare('PRAGMA table_info(user_secrets)').all();
    const cols = new Set();
    for (const r of res?.results || []) {
      if (r?.name) cols.add(String(r.name));
    }
    return cols;
  } catch {
    return new Set();
  }
}

function has(cols, col) {
  return cols && cols.has(col);
}

/**
 * @param {Record<string, unknown>} row
 */
export function parseSecretMetadata(row) {
  return parseJsonSafe(row?.metadata_json, {});
}

/**
 * API-safe list item (no encrypted material).
 * @param {Record<string, unknown>} row
 */
export function toSafeSecretItem(row) {
  const meta = parseSecretMetadata(row);
  const provider = trim(meta.provider || row.service_name);
  const category = trim(meta.category || (provider === PERSONAL_SERVICE_NAME ? 'personal' : 'provider'));
  const lastFour = trim(meta.last_four) || '????';
  const cfAccountId =
    trim(meta.cloudflare_account_id) || trim(meta.cf_account_id) || trim(meta.account_id) || '';

  return {
    id: row.id,
    workspace_id: null,
    category,
    provider: provider || null,
    secret_name: trim(row.secret_name) || trim(meta.secret_name) || null,
    label: trim(meta.label) || trim(row.description) || trim(row.secret_name) || null,
    status: Number(row.is_active) === 0 ? 'revoked' : 'active',
    scope: BYOK_USER_SCOPE,
    last_four: lastFour,
    cloudflare_account_mask: cfAccountId ? maskAccountId(cfAccountId) : null,
    byok_r2_bucket: trim(meta.default_bucket) || null,
    validated_at:
      meta.validated_at != null
        ? typeof meta.validated_at === 'number'
          ? new Date(meta.validated_at * 1000).toISOString()
          : String(meta.validated_at)
        : null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    last_used_at: row.last_used_at ?? null,
    rotated_at: meta.rotated_at ?? null,
    expires_at: row.expires_at ?? null,
  };
}

/**
 * @param {any} env
 * @param {{ userId: string, tenantId: string, categoryFilter?: string|null }} params
 */
export async function listUserSecrets(env, { userId, tenantId, categoryFilter = null }) {
  if (!env?.DB) return [];
  const db = env.DB;
  const cols = await userSecretsColumns(db);
  const where = ['user_id = ?', 'COALESCE(is_active, 1) = 1'];
  const binds = [userId];
  if (has(cols, 'tenant_id') && tenantId) {
    where.push('(tenant_id IS NULL OR tenant_id = ? OR tenant_id = \'\')');
    binds.push(tenantId);
  }

  const rows = await db
    .prepare(
      `SELECT id, user_id, tenant_id, workspace_id, secret_name, secret_type, description,
              service_name, is_active, expires_at, last_used_at, usage_count,
              metadata_json, created_at, updated_at
         FROM user_secrets
        WHERE ${where.join(' AND ')}
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 500`,
    )
    .bind(...binds)
    .all()
    .catch(() => ({ results: [] }));

  let items = (rows?.results || []).map((r) => toSafeSecretItem(r));
  const cat = trim(categoryFilter).toLowerCase();
  if (cat) {
    items = items.filter((i) => trim(i.category).toLowerCase() === cat);
  }
  return items;
}

/**
 * @param {any} env
 * @param {{ userId: string, tenantId: string, secretId: string }} params
 */
export async function getUserSecretScoped(env, { userId, tenantId, secretId }) {
  if (!env?.DB) return null;
  const cols = await userSecretsColumns(env.DB);
  const where = ['id = ?', 'user_id = ?'];
  const binds = [secretId, userId];
  if (has(cols, 'tenant_id') && tenantId) {
    where.push('(tenant_id IS NULL OR tenant_id = ? OR tenant_id = \'\')');
    binds.push(tenantId);
  }
  where.push('COALESCE(is_active, 1) = 1');

  return env.DB.prepare(
    `SELECT id, user_id, tenant_id, workspace_id, secret_name, secret_type, secret_value_encrypted,
            description, service_name, is_active, expires_at, metadata_json,
            created_at, updated_at, last_used_at
       FROM user_secrets
      WHERE ${where.join(' AND ')}
      LIMIT 1`,
  )
    .bind(...binds)
    .first()
    .catch(() => null);
}

/**
 * @param {any} env
 * @param {{ userId: string, tenantId: string, secretId: string }} params
 */
export async function decryptUserSecretPlaintext(env, { userId, tenantId, secretId }) {
  const row = await getUserSecretScoped(env, { userId, tenantId, secretId });
  if (!row?.secret_value_encrypted) return null;
  const meta = parseSecretMetadata(row);

  const plain = await decryptWithVault(env, row.secret_value_encrypted);
  if (!plain) return null;

  if (meta.kind === 'credential_bundle' && meta.provider === R2_SERVICE_NAME) {
    try {
      const bundle = JSON.parse(String(plain));
      return bundle;
    } catch {
      return null;
    }
  }
  return String(plain).trim();
}

/**
 * @param {any} env
 * @param {object} params
 */
export async function createUserSecret(env, params) {
  const {
    userId,
    tenantId,
    secretId = newSecretId(),
    serviceName,
    secretName,
    secretType = 'api_key',
    description,
    plaintext,
    metadata = {},
    expiresAt = null,
  } = params;

  const aesKey = await getAESKey(env, ['encrypt']);
  const encrypted = await aesGcmEncryptToB64(plaintext, aesKey);
  if (!encrypted) {
    throw new Error('ENCRYPT_FAILED');
  }

  const cols = await userSecretsColumns(env.DB);
  const fields = [
    ['id', secretId],
    ['user_id', userId],
    ['tenant_id', tenantId],
    ['workspace_id', null],
    ['secret_name', secretName],
    ['secret_value_encrypted', encrypted],
    ['secret_type', secretType],
    ['service_name', serviceName],
    ['description', description || null],
    ['metadata_json', JSON.stringify(metadata)],
    ['is_active', 1],
    ['expires_at', expiresAt],
    ['created_at', nowIso()],
    ['updated_at', nowIso()],
  ].filter(([col]) => has(cols, col));

  await env.DB.prepare(
    `INSERT INTO user_secrets (${fields.map(([c]) => c).join(', ')})
     VALUES (${fields.map(() => '?').join(', ')})`,
  )
    .bind(...fields.map(([, v]) => v))
    .run();

  return getUserSecretScoped(env, { userId, tenantId, secretId });
}

/**
 * @param {any} env
 * @param {object} params
 */
export async function updateUserSecretMetadata(env, { userId, tenantId, secretId, patchMeta, description }) {
  const row = await getUserSecretScoped(env, { userId, tenantId, secretId });
  if (!row) return null;
  const meta = { ...parseSecretMetadata(row), ...patchMeta };
  const cols = await userSecretsColumns(env.DB);
  const sets = ['metadata_json = ?'];
  const binds = [JSON.stringify(meta)];
  if (description != null && has(cols, 'description')) {
    sets.push('description = ?');
    binds.push(description);
  }
  if (has(cols, 'updated_at')) {
    sets.push('updated_at = ?');
    binds.push(nowIso());
  }
  await env.DB.prepare(
    `UPDATE user_secrets SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
  )
    .bind(...binds, secretId, userId)
    .run();
  return getUserSecretScoped(env, { userId, tenantId, secretId });
}

/**
 * @param {any} env
 * @param {object} params
 */
export async function rotateUserSecretValue(env, { userId, tenantId, secretId, plaintext }) {
  const aesKey = await getAESKey(env, ['encrypt']);
  const encrypted = await aesGcmEncryptToB64(plaintext, aesKey);
  if (!encrypted) throw new Error('ENCRYPT_FAILED');
  const row = await getUserSecretScoped(env, { userId, tenantId, secretId });
  if (!row) return null;
  const meta = parseSecretMetadata(row);
  const lastFour = lastFourOfSecret(
    typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext),
  );
  meta.last_four = lastFour;
  meta.rotated_at = nowIso();
  const cols = await userSecretsColumns(env.DB);
  await env.DB.prepare(
    `UPDATE user_secrets
        SET secret_value_encrypted = ?, metadata_json = ?, updated_at = ?
      WHERE id = ? AND user_id = ?`,
  )
    .bind(encrypted, JSON.stringify(meta), nowIso(), secretId, userId)
    .run();
  return getUserSecretScoped(env, { userId, tenantId, secretId });
}

/**
 * @param {any} env
 * @param {{ userId: string, secretId: string }} params
 */
export async function revokeUserSecret(env, { userId, secretId }) {
  const cols = await userSecretsColumns(env.DB);
  const sets = ['is_active = 0'];
  const binds = [];
  if (has(cols, 'updated_at')) {
    sets.push('updated_at = ?');
    binds.push(nowIso());
  }
  binds.push(secretId, userId);
  await env.DB.prepare(
    `UPDATE user_secrets SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
  )
    .bind(...binds)
    .run();
}

/**
 * Build metadata for a provider API key row.
 */
export function buildProviderKeyMetadata({
  provider,
  label,
  lastFour,
  category = 'provider',
  cloudflareAccountId = null,
  validated = false,
}) {
  if (!PROVIDERS.has(provider) && provider !== PERSONAL_SERVICE_NAME) {
    throw new Error('INVALID_PROVIDER');
  }
  const meta = {
    kind: 'provider_key',
    category,
    provider,
    label,
    last_four: lastFour,
    validation_status: validated ? 'pass' : null,
    validated_at: validated ? nowUnix() : null,
    rotated_at: null,
  };
  if (cloudflareAccountId) meta.cloudflare_account_id = cloudflareAccountId;
  return meta;
}

/**
 * Distinct configured BYOK provider slugs for a user (integrations / tiles).
 * @param {any} env
 * @param {{ userId: string, tenantId?: string|null }} scope
 */
export async function listConfiguredByokProviderSlugs(env, { userId, tenantId }) {
  const uid = trim(userId);
  if (!env?.DB || !uid) return [];
  const tid = trim(tenantId);
  const tenantClause = tid
    ? 'AND (tenant_id IS NULL OR tenant_id = \'\' OR tenant_id = ?)'
    : '';
  const binds = [uid];
  if (tenantClause) binds.push(tid);

  const { results } = await env.DB.prepare(
    `SELECT service_name, metadata_json
       FROM user_secrets
      WHERE user_id = ?
        AND COALESCE(is_active, 1) = 1
        ${tenantClause}`,
  )
    .bind(...binds)
    .all()
    .catch(() => ({ results: [] }));

  const slugs = new Set();
  for (const row of results || []) {
    const meta = parseSecretMetadata(row);
    const p = trim(meta.provider || row.service_name).toLowerCase();
    if (p && p !== 'personal') slugs.add(p);
  }
  return [...slugs];
}

export {
  lastFourOfSecret,
  parseJsonSafe,
  providerSecretName,
  R2_SECRET_NAME,
  R2_SERVICE_NAME,
};

export { resolveProviderCredential } from "./portable-provider-credential.js";

/**
 * Canonical BYOK persistence for AgentSamRemix.
 *
 * `user_secrets` is the only provider-key authority. Provider keys are user
 * scoped; workspace context is authorization/audit context, not another copy
 * of the credential. Internal user_secrets rows (PTY/tunnel/etc.) are not part
 * of the Settings Keys domain and can never be listed or revealed here.
 */
import { aesGcmEncryptToB64, getAESKey } from './crypto-vault.js';
import { decryptWithVault } from '../identity/oauth/token-store.js';
import {
  BYOK_USER_SCOPE,
  PERSONAL_SERVICE_NAME,
  PROVIDERS,
  providerSecretName,
} from './provider-catalog.js';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

export function parseJsonSafe(value, fallback = {}) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

export function lastFourOfSecret(value) {
  const text = String(value || '');
  return text.length >= 4 ? text.slice(-4) : '????';
}

export function newSecretId() {
  return `sec_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
}

export async function userSecretsColumns(db) {
  try {
    const res = await db.prepare('PRAGMA table_info(user_secrets)').all();
    return new Set((res?.results || []).map((row) => String(row?.name || '')).filter(Boolean));
  } catch {
    return new Set();
  }
}

function has(cols, column) {
  return cols?.has(column) === true;
}

function requiredColumnsPresent(cols) {
  return ['id', 'user_id', 'secret_name', 'secret_value_encrypted', 'service_name'].every((column) => has(cols, column));
}

const READ_COLUMNS = Object.freeze([
  'id',
  'user_id',
  'tenant_id',
  'workspace_id',
  'secret_name',
  'secret_type',
  'secret_value_encrypted',
  'description',
  'service_name',
  'is_active',
  'expires_at',
  'last_used_at',
  'usage_count',
  'metadata_json',
  'created_at',
  'updated_at',
]);

/** Pure helper so schema compatibility stays testable without D1. */
export function userSecretSelectList(columns) {
  const cols = columns instanceof Set ? columns : new Set(columns || []);
  return READ_COLUMNS
    .map((column) => has(cols, column) ? column : `NULL AS ${column}`)
    .join(', ');
}

function activeWhere(cols) {
  return has(cols, 'is_active') ? 'COALESCE(is_active, 1) = 1' : '1 = 1';
}

function orderBy(cols) {
  if (has(cols, 'updated_at') && has(cols, 'created_at')) return 'updated_at DESC, created_at DESC';
  if (has(cols, 'updated_at')) return 'updated_at DESC';
  if (has(cols, 'created_at')) return 'created_at DESC';
  return 'id DESC';
}

export function parseSecretMetadata(row) {
  return parseJsonSafe(row?.metadata_json, {});
}

function maskAccountId(value) {
  const text = trim(value);
  if (!text) return null;
  return `••••${text.slice(-4)}`;
}

/**
 * Settings may manage provider API keys and explicit personal secrets only.
 * Internal services such as iam_pty/cfd_tunnel are deliberately excluded even
 * if a caller knows their row id.
 */
export function isSettingsManagedSecret(row) {
  if (!row) return false;
  const meta = parseSecretMetadata(row);
  const service = trim(meta.provider || row.service_name).toLowerCase();
  const category = trim(meta.category).toLowerCase();
  const kind = trim(meta.kind).toLowerCase();
  if (service === PERSONAL_SERVICE_NAME || category === 'personal' || kind === 'personal_secret') return true;
  return PROVIDERS.has(service) && (category === '' || category === 'provider') && kind !== 'credential_bundle';
}

export function toSafeSecretItem(row) {
  const meta = parseSecretMetadata(row);
  const provider = trim(meta.provider || row.service_name).toLowerCase();
  const category = trim(meta.category || (provider === PERSONAL_SERVICE_NAME ? 'personal' : 'provider'));
  const accountId = trim(meta.cloudflare_account_id || meta.cf_account_id || meta.account_id);
  return {
    id: row.id,
    workspace_id: null,
    category,
    provider: provider || null,
    secret_name: trim(row.secret_name) || trim(meta.secret_name) || null,
    label: trim(meta.label) || trim(row.description) || trim(row.secret_name) || null,
    status: Number(row.is_active) === 0 ? 'revoked' : 'active',
    scope: BYOK_USER_SCOPE,
    last_four: trim(meta.last_four) || '????',
    cloudflare_account_mask: maskAccountId(accountId),
    validated_at: meta.validated_at != null
      ? typeof meta.validated_at === 'number'
        ? new Date(meta.validated_at * 1000).toISOString()
        : String(meta.validated_at)
      : null,
    validation_status: meta.validation_status ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    last_used_at: row.last_used_at ?? null,
    rotated_at: meta.rotated_at ?? null,
    expires_at: row.expires_at ?? null,
  };
}

export async function listUserSecrets(env, { userId, tenantId, categoryFilter = null }) {
  if (!env?.DB || !userId) return [];
  const cols = await userSecretsColumns(env.DB);
  if (!requiredColumnsPresent(cols)) return [];

  const where = ['user_id = ?', activeWhere(cols)];
  const binds = [String(userId)];
  if (has(cols, 'tenant_id') && tenantId) {
    where.push("(tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?)");
    binds.push(String(tenantId));
  }

  const rows = await env.DB.prepare(
    `SELECT ${userSecretSelectList(cols)}
       FROM user_secrets
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy(cols)}
      LIMIT 500`,
  ).bind(...binds).all().catch(() => ({ results: [] }));

  let items = (rows?.results || [])
    .filter(isSettingsManagedSecret)
    .map(toSafeSecretItem);
  const category = trim(categoryFilter).toLowerCase();
  if (category) items = items.filter((item) => trim(item.category).toLowerCase() === category);
  return items;
}

export async function getUserSecretScoped(env, { userId, tenantId, secretId }) {
  if (!env?.DB || !userId || !secretId) return null;
  const cols = await userSecretsColumns(env.DB);
  if (!requiredColumnsPresent(cols)) return null;

  const where = ['id = ?', 'user_id = ?', activeWhere(cols)];
  const binds = [String(secretId), String(userId)];
  if (has(cols, 'tenant_id') && tenantId) {
    where.push("(tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?)");
    binds.push(String(tenantId));
  }
  const row = await env.DB.prepare(
    `SELECT ${userSecretSelectList(cols)}
       FROM user_secrets
      WHERE ${where.join(' AND ')}
      LIMIT 1`,
  ).bind(...binds).first().catch(() => null);
  return isSettingsManagedSecret(row) ? row : null;
}

export async function decryptUserSecretPlaintext(env, { userId, tenantId, secretId }) {
  const row = await getUserSecretScoped(env, { userId, tenantId, secretId });
  if (!row?.secret_value_encrypted) return null;
  const plain = await decryptWithVault(env, row.secret_value_encrypted).catch(() => null);
  return plain == null ? null : String(plain).trim();
}

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

  const normalizedService = trim(serviceName).toLowerCase();
  if (!(PROVIDERS.has(normalizedService) || normalizedService === PERSONAL_SERVICE_NAME)) {
    throw new Error('settings_secret_service_forbidden');
  }

  const aesKey = await getAESKey(env, ['encrypt']);
  const encrypted = await aesGcmEncryptToB64(plaintext, aesKey);
  const cols = await userSecretsColumns(env.DB);
  if (!requiredColumnsPresent(cols)) throw new Error('user_secrets_schema_incompatible');

  const now = nowUnix();
  const fields = [
    ['id', secretId],
    ['user_id', userId],
    ['tenant_id', tenantId || null],
    ['workspace_id', null],
    ['secret_name', secretName],
    ['secret_value_encrypted', encrypted],
    ['secret_type', secretType],
    ['service_name', normalizedService],
    ['description', description || null],
    ['metadata_json', JSON.stringify(metadata)],
    ['is_active', 1],
    ['expires_at', expiresAt],
    ['created_at', now],
    ['updated_at', now],
  ].filter(([column]) => has(cols, column));

  await env.DB.prepare(
    `INSERT INTO user_secrets (${fields.map(([column]) => column).join(', ')})
     VALUES (${fields.map(() => '?').join(', ')})`,
  ).bind(...fields.map(([, value]) => value)).run();

  return getUserSecretScoped(env, { userId, tenantId, secretId });
}

export async function updateUserSecretMetadata(env, { userId, tenantId, secretId, patchMeta, description }) {
  const row = await getUserSecretScoped(env, { userId, tenantId, secretId });
  if (!row) return null;
  const meta = { ...parseSecretMetadata(row), ...(patchMeta || {}) };
  const cols = await userSecretsColumns(env.DB);
  const sets = [];
  const binds = [];
  if (has(cols, 'metadata_json')) {
    sets.push('metadata_json = ?');
    binds.push(JSON.stringify(meta));
  }
  if (description != null && has(cols, 'description')) {
    sets.push('description = ?');
    binds.push(description);
  }
  if (has(cols, 'updated_at')) {
    sets.push('updated_at = ?');
    binds.push(nowUnix());
  }
  if (!sets.length) return row;
  await env.DB.prepare(
    `UPDATE user_secrets SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
  ).bind(...binds, secretId, userId).run();
  return getUserSecretScoped(env, { userId, tenantId, secretId });
}

export async function rotateUserSecretValue(env, { userId, tenantId, secretId, plaintext }) {
  const row = await getUserSecretScoped(env, { userId, tenantId, secretId });
  if (!row) return null;
  const aesKey = await getAESKey(env, ['encrypt']);
  const encrypted = await aesGcmEncryptToB64(plaintext, aesKey);
  const meta = parseSecretMetadata(row);
  meta.last_four = lastFourOfSecret(plaintext);
  meta.rotated_at = nowUnix();
  const cols = await userSecretsColumns(env.DB);
  const sets = ['secret_value_encrypted = ?'];
  const binds = [encrypted];
  if (has(cols, 'metadata_json')) {
    sets.push('metadata_json = ?');
    binds.push(JSON.stringify(meta));
  }
  if (has(cols, 'updated_at')) {
    sets.push('updated_at = ?');
    binds.push(nowUnix());
  }
  await env.DB.prepare(
    `UPDATE user_secrets SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
  ).bind(...binds, secretId, userId).run();
  return getUserSecretScoped(env, { userId, tenantId, secretId });
}

export async function revokeUserSecret(env, { userId, secretId }) {
  const cols = await userSecretsColumns(env.DB);
  if (!has(cols, 'is_active')) throw new Error('user_secrets_revoke_unsupported');
  const sets = ['is_active = 0'];
  const binds = [];
  if (has(cols, 'updated_at')) {
    sets.push('updated_at = ?');
    binds.push(nowUnix());
  }
  await env.DB.prepare(
    `UPDATE user_secrets SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
  ).bind(...binds, secretId, userId).run();
}

export function buildProviderKeyMetadata({ provider, label, lastFour, category = 'provider', cloudflareAccountId = null, validated = false }) {
  if (category !== 'personal' && !PROVIDERS.has(provider)) throw new Error('INVALID_PROVIDER');
  const meta = {
    kind: category === 'personal' ? 'personal_secret' : 'provider_key',
    category,
    provider: category === 'personal' ? PERSONAL_SERVICE_NAME : provider,
    label,
    last_four: lastFour,
    validation_status: validated ? 'pass' : null,
    validated_at: validated ? nowUnix() : null,
    rotated_at: null,
  };
  if (cloudflareAccountId) meta.cloudflare_account_id = cloudflareAccountId;
  return meta;
}

export async function resolveProviderCredential(env, { userId, tenantId, provider }) {
  const normalized = trim(provider).toLowerCase();
  if (!normalized || !PROVIDERS.has(normalized)) return null;

  if (env?.DB && userId) {
    const cols = await userSecretsColumns(env.DB);
    if (requiredColumnsPresent(cols)) {
      const where = ['user_id = ?', 'service_name = ?', activeWhere(cols)];
      const binds = [String(userId), normalized];
      if (has(cols, 'tenant_id') && tenantId) {
        where.push("(tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?)");
        binds.push(String(tenantId));
      }
      const row = await env.DB.prepare(
        `SELECT id FROM user_secrets WHERE ${where.join(' AND ')}
         ORDER BY ${orderBy(cols)} LIMIT 1`,
      ).bind(...binds).first().catch(() => null);
      if (row?.id) {
        const value = await decryptUserSecretPlaintext(env, {
          userId,
          tenantId,
          secretId: String(row.id),
        });
        if (value) return value;
      }
    }
  }

  const envFallbacks = {
    google: ['GOOGLE_AI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    openai: ['OPENAI_API_KEY'],
    anthropic: ['ANTHROPIC_API_KEY'],
    cloudflare: ['CLOUDFLARE_API_TOKEN'],
    resend: ['RESEND_API_KEY'],
  };
  for (const name of envFallbacks[normalized] || []) {
    const value = trim(env?.[name]);
    if (value) return value;
  }
  return null;
}

export { providerSecretName, PERSONAL_SERVICE_NAME };

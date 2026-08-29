/**
 * src/core/oauth-token-store.js
 * Neutral OAuth token writer — imported by both oauth.js and oauth-login-callbacks.js.
 * Extracted to eliminate circular dependency between those two modules.
 *
 * RULE: Do NOT import from src/api/oauth.js or src/api/oauth-login-callbacks.js.
 */

import { aesGcmDecryptFromB64, aesGcmEncryptToB64, getAESKey } from '../../credentials/crypto-vault.js';
import { assertVaultConfigured } from '../../credentials/vault-key-material.js';
import { OAUTH_TOKEN_PROVIDERS } from '../contracts/oauth-provider-lanes.js';
import { resolveIntegrationUserId, invalidateGithubReposSessionCache } from './integration-user-id.js';

async function pragmaColumns(DB, tableName) {
  const out = await DB.prepare(`PRAGMA table_info(${tableName})`).all();
  const cols = new Set();
  for (const row of out.results || []) cols.add(String(row.name || '').toLowerCase());
  return cols;
}

export async function ensureOauthTokenColumns(DB) {
  const cols = await pragmaColumns(DB, 'user_oauth_tokens');
  const alters = [];
  const want = [
    ['access_token_encrypted', 'TEXT'],
    ['refresh_token_encrypted', 'TEXT'],
    ['scopes', 'TEXT'],
    ['account_email', 'TEXT'],
    ['account_display', 'TEXT'],
    ['workspace_id', 'TEXT'],
    ['metadata_json', 'TEXT'],
    ['created_at', 'INTEGER'],
    ['updated_at', 'INTEGER'],
    ['is_active', 'INTEGER NOT NULL DEFAULT 1'],
    ['revoked_at', 'INTEGER'],
    ['revoked_by', 'TEXT'],
    ['last_refresh_at', 'INTEGER'],
    ['last_refresh_error_code', 'TEXT'],
    ['refresh_failure_count', 'INTEGER NOT NULL DEFAULT 0'],
  ];
  for (const [name, type] of want) {
    if (!cols.has(name)) alters.push(`ALTER TABLE user_oauth_tokens ADD COLUMN ${name} ${type}`);
  }
  for (const sql of alters) {
    try { await DB.prepare(sql).run(); } catch { /* ignore older D1 schema edge-cases */ }
  }
  return await pragmaColumns(DB, 'user_oauth_tokens');
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

async function encryptWithVault(env, plaintext) {
  const key = await getAESKey(env, ['encrypt']);
  return aesGcmEncryptToB64(plaintext, key);
}

async function decryptWithVault(env, encryptedB64) {
  const key = await getAESKey(env, ['decrypt']);
  return aesGcmDecryptFromB64(encryptedB64, key);
}

function normalizeProvider(provider) {
  const p = String(provider || '').trim().toLowerCase();
  if (p === 'gdrive' || p === 'google_drive' || p === 'google_gmail' || p === 'google_calendar') return 'google';
  return p;
}

function mapTokenProviderForStorage(provider) {
  const p = String(provider || '').trim().toLowerCase();
  if (p === 'google') return 'google_drive';
  return provider;
}

export async function upsertOauthToken(
  env,
  {
    user_id,
    tenant_id,
    person_uuid,
    provider,
    access_token,
    refresh_token,
    scope,
    expires_at,
    account_identifier,
    account_email,
    account_display,
    workspace_id,
    metadata_json,
  },
  opts = {},
) {
  const skipRegistry = !!opts.skipRegistry;
  if (!env?.DB) throw new Error('DB not configured');
  assertVaultConfigured(env);

  let canonicalUserId = String(user_id || '').trim();
  if (canonicalUserId) {
    const resolved = await resolveIntegrationUserId(env, { id: canonicalUserId });
    if (resolved) canonicalUserId = resolved;
  }
  if (!canonicalUserId) throw new Error('user_id required for oauth token upsert');

  const cols = await ensureOauthTokenColumns(env.DB); // PRAGMA requirement before write
  const createdAt = nowSeconds();
  const updatedAt = createdAt;

  const providerForDb = mapTokenProviderForStorage(provider);
  if (!OAUTH_TOKEN_PROVIDERS.includes(providerForDb)) {
    throw new Error(`Unsupported OAuth token provider: ${provider}`);
  }
  const encryptedAccess = access_token ? await encryptWithVault(env, access_token) : null;
  const encryptedRefresh = refresh_token ? await encryptWithVault(env, refresh_token) : null;

  const hasEncrypted = cols.has('access_token_encrypted');
  const hasPlain = cols.has('access_token');

  // Prefer encrypted columns, but keep plaintext columns if they already exist and were historically used.
  const accessPlain = hasPlain && access_token ? access_token : null;
  const refreshPlain = cols.has('refresh_token') && refresh_token ? refresh_token : null;

  const scopesVal = scope || null;
  const driveCanonicalEmpty =
    providerForDb === 'google_drive' &&
    (account_identifier === '' ||
      (account_identifier == null && !(account_email && String(account_email).trim())));
  const accountIdVal = driveCanonicalEmpty
    ? ''
    : String(account_identifier ?? account_email ?? '').trim();

  if (!accountIdVal && !driveCanonicalEmpty) {
    throw new Error(`account_identifier missing for provider ${provider}`);
  }

  const insert = [
    ['user_id', canonicalUserId],
    ['tenant_id', String(tenant_id || '')],
    ['person_uuid', String(person_uuid || '')],
    ['provider', providerForDb],
    ['account_identifier', String(accountIdVal || providerForDb)],
  ];
  const add = (name, value) => {
    if (cols.has(name)) insert.push([name, value]);
  };
  if (hasPlain) insert.push(['access_token', accessPlain]);
  add('refresh_token', refreshPlain);
  add('access_token_encrypted', encryptedAccess);
  add('refresh_token_encrypted', encryptedRefresh);
  add('scope', scopesVal);
  add('scopes', scopesVal);
  insert.push(['expires_at', expires_at || null]);
  add('workspace_id', workspace_id ?? null);
  add('metadata_json', metadata_json ?? null);
  add('account_email', account_email || null);
  add('account_display', account_display || null);
  add('created_at', createdAt);
  add('updated_at', updatedAt);
  add('is_active', 1);
  add('revoked_at', null);
  add('revoked_by', null);
  add('last_refresh_at', null);
  add('last_refresh_error_code', null);
  add('refresh_failure_count', 0);

  // Reconnecting is an explicit reactivation: INSERT OR REPLACE clears any prior
  // revocation and refresh-failure state while preserving compatibility with legacy schemas.
  const sql = `INSERT OR REPLACE INTO user_oauth_tokens
    (${insert.map(([name]) => name).join(', ')})
    VALUES (${insert.map(() => '?').join(', ')})`;
  const binds = insert.map(([, value]) => value);

  await env.DB.prepare(sql).bind(...binds).run();

  const registryKey = provider === 'cloudflare'
    ? 'cloudflare_oauth'
    : providerForDb;

  if (!skipRegistry) {
    const display =
      account_display || account_email || account_identifier || null;
    const tid = String(tenant_id || '');
    const displayNameByKey = {
      cloudflare_oauth: 'Cloudflare Developer Platform',
      google_drive: 'Google Drive',
      github: 'GitHub',
    };
    const displayName = displayNameByKey[registryKey] || registryKey;
    const categoryByKey = {
      cloudflare_oauth: 'deployment',
      google_drive: 'storage',
      github: 'source_control',
    };
    const category = categoryByKey[registryKey] || 'other';
    try {
      await env.DB.prepare(
        `INSERT INTO integration_registry (
           id, tenant_id, provider_key, display_name, category, auth_type, status,
           account_display, sort_order, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'oauth2', 'connected', ?, 50, datetime('now'))
         ON CONFLICT(tenant_id, provider_key) DO UPDATE SET
           status = 'connected',
           account_display = COALESCE(excluded.account_display, integration_registry.account_display),
           updated_at = datetime('now')`,
      )
        .bind(
          `int_${registryKey}_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
          tid,
          registryKey,
          displayName,
          category,
          display,
        )
        .run();
    } catch {
      try {
        await env.DB.prepare(
          `UPDATE integration_registry
           SET status = 'connected', account_display = COALESCE(?, account_display), updated_at = datetime('now')
           WHERE tenant_id = ? AND provider_key = ?`,
        )
          .bind(display, tid, registryKey)
          .run();
      } catch {
        /* ignore */
      }
    }

    try {
      await env.DB.prepare(
        `INSERT INTO integration_events (tenant_id, provider_key, event_type, actor, message, metadata_json)
         VALUES (?, ?, 'connected', ?, ?, ?)`,
      )
        .bind(
          tid,
          registryKey,
          String(canonicalUserId),
          'OAuth connection established',
          JSON.stringify({ account_display: display }),
        )
        .run();
    } catch {
      /* ignore */
    }
  }

  if (providerForDb === 'github' || providerForDb === 'github_app') {
    await invalidateGithubReposSessionCache(
      env,
      canonicalUserId,
      accountIdVal,
      workspace_id != null ? String(workspace_id) : '',
    );
  }
}

export {
  nowSeconds,
  encryptWithVault,
  decryptWithVault,
  pragmaColumns,
  normalizeProvider,
  mapTokenProviderForStorage,
};

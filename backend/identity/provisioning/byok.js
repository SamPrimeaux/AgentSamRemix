/**
 * BYOK reads and encryption helpers.
 *
 * `user_secrets` is the only supported user credential store.
 */
import { getAESKey, aesGcmEncryptToB64 } from '../../credentials/crypto-vault.js';
import { decryptWithVault } from '../oauth/token-store.js';

const LLM_VAULT_PROJECT = 'iam_user_llm_keys';
const BYOK_PROVIDER_SECRET = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google_ai: 'GEMINI_API_KEY',
  google: 'GEMINI_API_KEY',
};

async function legacyLlmVaultByok(env, userId, tenantId, provider) {
  const secretName = BYOK_PROVIDER_SECRET[provider];
  if (!secretName) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT secret_value_encrypted, metadata_json
         FROM user_secrets
        WHERE tenant_id = ? AND user_id = ? AND secret_name = ?
          AND project_label = ? AND is_active = 1
        LIMIT 1`,
    ).bind(tenantId, userId, secretName, LLM_VAULT_PROJECT).first();
    if (!row?.secret_value_encrypted) return null;
    const key = await decryptWithVault(env, row.secret_value_encrypted);
    let preview = null;
    try {
      const meta = JSON.parse(String(row.metadata_json || '{}'));
      preview = meta.last4 ? `••••${meta.last4}` : null;
    } catch {}
    return { key, preview, source: 'iam_user_llm_keys_legacy' };
  } catch (error) {
    console.warn('[getUserBYOKey] legacy iam slot', error?.message ?? error);
    return null;
  }
}

export async function getUserBYOKey(env, userId, tenantId, provider, opts = {}) {
  if (!env?.DB || !userId || !tenantId || !provider) return null;
  const normalized = String(provider).trim().toLowerCase();
  const providers =
    normalized === 'google_ai'
      ? ['google', 'google_ai']
      : normalized === 'google'
        ? ['google', 'google_ai']
        : [normalized];

  try {
    let row = null;
    for (const lookup of providers) {
      row = await env.DB.prepare(
        `SELECT id, secret_value_encrypted, metadata_json, service_name,
                workspace_id, last_used_at
           FROM user_secrets
          WHERE user_id = ?
            AND COALESCE(is_active, 1) = 1
            AND (tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?)
            AND (
              LOWER(COALESCE(service_name, '')) = LOWER(?)
              OR LOWER(COALESCE(json_extract(metadata_json, '$.provider'), '')) = LOWER(?)
            )
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 1`,
      ).bind(userId, tenantId, lookup, lookup).first().catch(() => null);
      if (row) break;
    }
    if (!row) return legacyLlmVaultByok(env, userId, tenantId, normalized);
    if (!row.secret_value_encrypted) return null;

    const key = await decryptWithVault(env, row.secret_value_encrypted);
    if (!key) return null;
    let preview = null;
    try {
      const meta = JSON.parse(String(row.metadata_json || '{}'));
      preview = meta.last_four ? `••••${meta.last_four}` : meta.last4 ? `••••${meta.last4}` : null;
    } catch {}
    return { key, preview, source: 'user_secrets' };
  } catch (error) {
    console.warn('[getUserBYOKey]', error?.message ?? error);
    return null;
  }
}

/** Encrypt a user secret with the platform vault key. */
export async function encryptApiKeyForStorage(env, plaintext) {
  if (plaintext == null || String(plaintext) === '') {
    throw new Error('secret_plaintext_required');
  }
  const aesKey = await getAESKey(env, ['encrypt']);
  return aesGcmEncryptToB64(String(plaintext), aesKey);
}

/** Compatibility mapping for callers that receive an API platform label. */
export function byokProviderSlugFromApiPlatform(apiPlatform) {
  const platform = String(apiPlatform || '').trim();
  if (platform === 'anthropic_api') return 'anthropic';
  if (platform === 'openai' || platform === 'cursor') return 'openai';
  if (['gemini_api', 'vertex_ai', 'google_ai'].includes(platform)) return 'google';
  return null;
}

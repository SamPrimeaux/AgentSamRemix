import { decryptWithVault } from '../identity/oauth/token-store.js';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

const ENV_FALLBACKS = Object.freeze({
  google: ['GOOGLE_AI_API_KEY', 'GEMINI_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
});

/**
 * Read-only provider credential resolver. user_secrets remains the single BYOK
 * authority; env secrets are deployment credentials, never persisted or logged.
 */
export async function resolveProviderCredential(env, { userId, tenantId, provider }) {
  const normalized = trim(provider).toLowerCase();
  const uid = trim(userId);
  if (!normalized) throw new Error('embedding_provider_required');

  if (uid && env?.DB) {
    const binds = [uid, normalized];
    let tenantClause = '';
    if (tenantId) {
      tenantClause = " AND (tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?)";
      binds.push(trim(tenantId));
    }
    const row = await env.DB.prepare(
      `SELECT secret_value_encrypted
         FROM user_secrets
        WHERE user_id = ? AND service_name = ? AND COALESCE(is_active, 1) = 1
          ${tenantClause}
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1`,
    ).bind(...binds).first().catch(() => null);
    if (row?.secret_value_encrypted) {
      const plain = await decryptWithVault(env, row.secret_value_encrypted).catch(() => null);
      if (trim(plain)) return trim(plain);
    }
  }

  for (const name of ENV_FALLBACKS[normalized] || []) {
    const value = trim(env?.[name]);
    if (value) return value;
  }
  return null;
}

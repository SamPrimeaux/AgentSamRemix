/**
 * BYOK status for SDK init, backed by the canonical user_secrets store.
 */
import { getUserBYOKey } from '../../backend/identity/provisioning/byok.js';

const SDK_BYOK_PROVIDERS = ['openai', 'anthropic', 'google'];

/**
 * @param {Record<string, unknown>} env
 * @param {string} userId
 * @param {string} tenantId
 */
export async function resolveSdkByokStatus(env, userId, tenantId) {
  const out = {};
  if (!env?.DB || !userId || !tenantId) {
    for (const p of SDK_BYOK_PROVIDERS) out[p] = { configured: false, masked: null };
    return out;
  }
  for (const provider of SDK_BYOK_PROVIDERS) {
    const row = await getUserBYOKey(env, userId, tenantId, provider).catch(() => null);
    const preview = row?.preview ? String(row.preview).trim() : '';
    out[provider] = {
      configured: Boolean(row?.key),
      masked: preview ? `••••${preview.slice(-4)}` : null,
      source: row?.source || null,
    };
  }
  return out;
}

import { resolveApiKey } from '../core/vault.js';
import { getIntegrationOAuthRow } from '../../backend/identity/oauth/user-token.js';
import {
  OPENAI_PLATFORM_DEFAULT_SECRET,
  resolveOpenAiApiKey,
  resolveOpenAiSecretKeyName,
} from './openai-credentials.js';

export {
  OPENAI_PLATFORM_DEFAULT_SECRET,
  OPENAI_AGENTSAM_GPT_TIER_SECRET,
  resolveOpenAiApiKey,
  resolveOpenAiSecretKeyName,
  modelKeyUsesAgentsamGptServiceKey,
} from './openai-credentials.js';

/**
 * OAuth row for integration routes (GitHub, Google Drive, etc.):
 * vault / encrypted / plaintext token resolution and Google refresh when expired.
 * @param {object} env Worker env (DB + secrets for decrypt/refresh)
 */
export async function getIntegrationToken(env, userId, provider, accountId) {
  if (!env?.DB || !userId || !provider) return null;
  const aid = accountId != null ? String(accountId) : '';
  return getIntegrationOAuthRow(env, userId, provider, aid);
}

export async function resolveModelApiKey(env, provider, modelKey, userId) {
  const p = String(provider || '').trim().toLowerCase();
  const uid = userId != null && String(userId).trim() !== '' ? String(userId).trim() : null;

  let catalogSecret = null;
  if (env?.DB && modelKey) {
    try {
      const row = await env.DB.prepare(
        `SELECT secret_key_name
         FROM agentsam_ai
         WHERE (provider = ? OR api_platform = ? OR model_key = ?)
         ORDER BY COALESCE(is_active, 1) DESC
         LIMIT 1`,
      )
        .bind(provider, provider, modelKey)
        .first();
      catalogSecret = row?.secret_key_name ? String(row.secret_key_name).trim() : null;
    } catch (_) {
      /* no row */
    }
  }

  if (p === 'openai') {
    return resolveOpenAiApiKey(env, modelKey, uid, { secretKeyName: catalogSecret });
  }

  const defaultName =
    p === 'anthropic' ? 'ANTHROPIC_API_KEY' :
    (p === 'google' || p === 'gemini') ? 'GOOGLE_AI_API_KEY' : null;

  if (defaultName) {
    const fromDefault = await resolveApiKey(env, uid, defaultName);
    if (fromDefault) return fromDefault;
    if (p === 'google' || p === 'gemini') {
      for (const alias of ['GEMINI_API_KEY', 'GOOGLE_API_KEY']) {
        const fromAlias = await resolveApiKey(env, uid, alias);
        if (fromAlias) return fromAlias;
      }
    }
  }

  if (catalogSecret) {
    const fromRow = await resolveApiKey(env, uid, catalogSecret);
    if (fromRow) return fromRow;
  }
  return null;
}

/**
 * LLM BYOK — single source of truth: user_secrets (provider keys).
 * iam_user_llm_keys project_label is legacy fallback only.
 */

export const LLM_VAULT_SECRET_NAMES = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY'];

export const SECRET_NAME_TO_PROVIDER = {
  OPENAI_API_KEY: 'openai',
  ANTHROPIC_API_KEY: 'anthropic',
  GEMINI_API_KEY: 'google',
};

export const PROVIDER_TO_SECRET_NAME = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GEMINI_API_KEY',
  google_ai: 'GEMINI_API_KEY',
};

const LEGACY_VAULT_PROJECT = 'iam_user_llm_keys';

function maskFromLast4(secretName, last4) {
  const l4 = last4 || '????';
  if (secretName === 'ANTHROPIC_API_KEY') return `sk-ant-...${l4}`;
  if (secretName === 'OPENAI_API_KEY') return `sk-...${l4}`;
  if (secretName === 'GEMINI_API_KEY') return `AIza...${l4}`;
  return `••••${l4}`;
}

function lastFourFromMeta(meta) {
  if (meta?.last_four != null && String(meta.last_four).trim()) return String(meta.last_four).trim();
  if (meta?.last4 != null && String(meta.last4).trim()) return String(meta.last4).trim();
  return '????';
}

function parseMeta(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

async function findProviderSecretRow(env, tenantId, userId, provider) {
  return env.DB.prepare(
    `SELECT id, metadata_json, description, created_at, updated_at
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
  )
    .bind(userId, tenantId, provider, provider)
    .first()
    .catch(() => null);
}

/**
 * Model picker BYOK status from user_secrets (canonical).
 * @returns {Promise<Record<string, { configured: boolean, masked: string | null, secret_id: string | null, api_key_id: string | null, source: string }>>}
 */
export async function getTenantLlmByokStatus(env, { tenantId, userId }) {
  /** @type {Record<string, { configured: boolean, masked: string | null, secret_id: string | null, api_key_id: string | null, source: string }>} */
  const out = {};
  if (!env?.DB || !tenantId || !userId) {
    for (const n of LLM_VAULT_SECRET_NAMES) {
      out[n] = { configured: false, masked: null, secret_id: null, api_key_id: null, source: 'none' };
    }
    return out;
  }

  for (const secretName of LLM_VAULT_SECRET_NAMES) {
    const provider = SECRET_NAME_TO_PROVIDER[secretName];
    let configured = false;
    let masked = null;
    let secret_id = null;
    let api_key_id = null;
    let source = 'none';

    const secretRow = await findProviderSecretRow(env, tenantId, userId, provider);
    if (secretRow?.id) {
      const meta = parseMeta(secretRow.metadata_json);
      const last4 = lastFourFromMeta(meta);
      configured = true;
      masked = maskFromLast4(secretName, last4);
      secret_id = String(secretRow.id);
      api_key_id = secret_id;
      source = 'user_secrets';
    } else {
      const legacy = await env.DB.prepare(
        `SELECT id, metadata_json FROM user_secrets
         WHERE tenant_id = ? AND user_id = ? AND secret_name = ? AND project_label = ? AND is_active = 1
         LIMIT 1`,
      )
        .bind(tenantId, userId, secretName, LEGACY_VAULT_PROJECT)
        .first()
        .catch(() => null);
      if (legacy?.id) {
        const meta = parseMeta(legacy.metadata_json);
        const last4 = lastFourFromMeta(meta);
        configured = true;
        masked = maskFromLast4(secretName, last4);
        secret_id = String(legacy.id);
        api_key_id = secret_id;
        source = 'iam_user_llm_keys_legacy';
      }
    }

    out[secretName] = { configured, masked, secret_id, api_key_id, source };
  }
  return out;
}

/** @param {string} apiPlatform */
export function llmSecretNameForApiPlatform(apiPlatform) {
  const p = String(apiPlatform || '').trim().toLowerCase();
  if (p === 'openai' || p === 'cursor') return 'OPENAI_API_KEY';
  if (p === 'anthropic_api' || p === 'anthropic') return 'ANTHROPIC_API_KEY';
  if (p === 'gemini_api' || p === 'google_ai' || p === 'google_ai_studio' || p === 'vertex_ai') {
    return 'GEMINI_API_KEY';
  }
  return null;
}

export async function listLlmKeysFromUserApiKeys(env, tenantId, userId) {
  if (!env?.DB || !tenantId || !userId) return [];
  const providers = ['openai', 'anthropic', 'google'];
  const items = [];

  for (const provider of providers) {
    const row = await findProviderSecretRow(env, tenantId, userId, provider);
    if (!row?.id) continue;

    const meta = parseMeta(row.metadata_json);
    const last4 = lastFourFromMeta(meta);
    const secretName = PROVIDER_TO_SECRET_NAME[provider] || provider;
    const masked =
      secretName === 'OPENAI_API_KEY'
        ? `sk-...${last4}`
        : secretName === 'ANTHROPIC_API_KEY'
          ? `sk-ant-...${last4}`
          : secretName === 'GEMINI_API_KEY'
            ? `AIza...${last4}`
            : `••••${last4}`;
    const providerLabel =
      provider === 'openai'
        ? 'OpenAI'
        : provider === 'anthropic'
          ? 'Anthropic'
          : provider === 'google'
            ? 'Gemini'
            : provider;

    items.push({
      id: String(row.id),
      key_name: secretName,
      provider: providerLabel,
      masked,
      last4,
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
      source: 'user_secrets',
    });
  }

  return items.sort((a, b) => String(a.provider).localeCompare(String(b.provider)));
}

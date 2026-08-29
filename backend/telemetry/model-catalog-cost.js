import { providerModelIdFromCatalogRow } from '../agentsam/catalog/model-identity.js';

/** Informal / UI ids that should resolve to catalog model_key rows. */
const INFORMAL_TO_CATALOG_KEY = {
  'claude-haiku-4.5': 'claude-haiku-4-5-20251001',
};

/**
 * True when the string is a Workers AI binding id (D1 / AI.run).
 * @param {string} s
 */
export function isWorkersAiBindingId(s) {
  return typeof s === 'string' && s.startsWith('@cf/');
}

/**
 * Map a provider's raw API model id to agentsam_model_catalog.model_key when possible.
 * Uses PRAGMA to detect optional id columns (anthropic_model_id, openai_model_id, workers_ai_model_id, etc.).
 *
 * Workers AI: prefers `workers_ai_model_id` on the catalog row (authoritative binding → single model_key).
 *
 * @param {import('@cloudflare/workers-types').D1Database | null | undefined} db
 * @param {string | null | undefined} provider
 * @param {string | null | undefined} rawModelId
 * @returns {Promise<{ modelKey: string | null, rawModelId: string | null }>}
 */
export async function resolveModelKeyFromProviderId(db, provider, rawModelId) {
  if (!db || rawModelId == null) return { modelKey: null, rawModelId: null };
  const originalRaw = String(rawModelId).trim();
  if (!originalRaw) return { modelKey: null, rawModelId: null };
  const informal = INFORMAL_TO_CATALOG_KEY[originalRaw.toLowerCase()];
  let lookup = informal || originalRaw;

  try {
    const p = String(provider || '').toLowerCase();
    const providerGroup =
      p.includes('anthropic') || p === 'claude'
        ? 'anthropic'
        : p.includes('openai') || p.includes('gpt') || p === 'deepseek'
          ? p === 'deepseek'
            ? 'deepseek'
            : 'openai'
          : p.includes('google') || p.includes('gemini') || p === 'vertex'
            ? 'google'
            : p.includes('worker') || p === 'cloudflare'
              ? 'workers_ai'
              : p;
    const { results } = await db
      .prepare(`SELECT * FROM agentsam_model_catalog WHERE is_active = 1`)
      .all();
    const row = (results || []).find((candidate) => {
      const candidateProvider = String(candidate?.provider || '').trim().toLowerCase();
      if (providerGroup && candidateProvider !== providerGroup) return false;
      const modelKey = String(candidate?.model_key || '').trim();
      return modelKey === lookup || providerModelIdFromCatalogRow(candidate) === lookup;
    });
    if (row?.model_key != null) {
      return { modelKey: String(row.model_key).trim(), rawModelId: originalRaw };
    }

    return { modelKey: null, rawModelId: originalRaw };
  } catch {
    return { modelKey: null, rawModelId: originalRaw };
  }
}

/**
 * Load billing rates from agentsam_ai (PRAGMA-safe).
 * @param {import('@cloudflare/workers-types').D1Database | null | undefined} db
 * @param {string | null | undefined} modelKey
 */
export async function loadAgentsamAiPricingRow(db, modelKey) {
  const mk = modelKey != null ? String(modelKey).trim() : '';
  if (!mk || !db) return null;
  try {
    const row = await db
      .prepare(
        `SELECT model_key, pricing_unit, input_rate_per_mtok, output_rate_per_mtok,
                cache_read_rate_per_mtok, cache_write_rate_per_mtok,
                cache_write_1h_rate_per_mtok, pricing_extras_json
           FROM agentsam_ai
         WHERE model_key = ? AND mode = 'model' AND status = 'active'
         LIMIT 1`,
      )
      .bind(mk)
      .first();
    return row ? mergeAgentsamAiPricingExtras(row) : null;
  } catch {
    return null;
  }
}

/**
 * Merge pricing_extras_json into a flat rate row for cost math.
 * @param {Record<string, unknown>} row
 */
export function mergeAgentsamAiPricingExtras(row) {
  const out = { ...row };
  let extras = {};
  try {
    extras = row?.pricing_extras_json
      ? JSON.parse(String(row.pricing_extras_json))
      : {};
  } catch {
    extras = {};
  }
  if (extras && typeof extras === 'object') {
    for (const [k, v] of Object.entries(extras)) {
      if (out[k] == null && v != null) out[k] = v;
    }
  }
  /** Documented alias: cache_write_rate_per_mtok is always 5m write. */
  if (out.cache_write_5m_rate_per_mtok == null && out.cache_write_rate_per_mtok != null) {
    out.cache_write_5m_rate_per_mtok = out.cache_write_rate_per_mtok;
  }
  return out;
}

/**
 * USD cost from agentsam_ai rate row. Does not double-bill cache reads at full input rate.
 * @param {Record<string, unknown> | null | undefined} ratesRow
 * @param {{ inputTokens?: number, outputTokens?: number, cacheReadTokens?: number, cacheWriteTokens?: number, cacheWriteTtl?: string }} u
 */
export function computeUsdFromAgentsamAiRates(ratesRow, u = {}) {
  if (!ratesRow) return 0;
  const unit = String(ratesRow.pricing_unit || 'usd_per_mtok').toLowerCase();
  if (unit === 'free' || unit === 'subscription') return 0;

  const inR = Number(ratesRow.input_rate_per_mtok) || 0;
  const outR = Number(ratesRow.output_rate_per_mtok) || 0;
  const cr = Number(ratesRow.cache_read_rate_per_mtok) || 0;
  const cw5 =
    Number(ratesRow.cache_write_5m_rate_per_mtok ?? ratesRow.cache_write_rate_per_mtok) || 0;
  const cw1h = Number(ratesRow.cache_write_1h_rate_per_mtok) || 0;
  const rawIn = Number(u.inputTokens) || 0;
  const crTok = Number(u.cacheReadTokens) || 0;
  const cwTok = Number(u.cacheWriteTokens) || 0;
  const outTok = Number(u.outputTokens) || 0;
  const uncachedIn = Math.max(0, rawIn - crTok - cwTok);

  const ttl = String(u.cacheWriteTtl || '5m').trim().toLowerCase();
  const cw5Tok = ttl === '1h' ? 0 : cwTok;
  const cw1hTok = ttl === '1h' ? cwTok : 0;
  const cw5Rate = cw5;
  const cw1hRate = cw1h;

  if (unit === 'neurons_per_mtok') {
    const inCost = uncachedIn * inR * 0.000011;
    const outCost = outTok * outR * 0.000011;
    return (inCost + outCost) / 1_000_000;
  }

  return (
    uncachedIn * inR + outTok * outR + crTok * cr + cw5Tok * cw5Rate + cw1hTok * cw1hRate
  ) / 1_000_000;
}

export async function estimateCostUsdFromCatalog(db, modelKey, inputTokens, outputTokens) {
  if (!db || modelKey == null) return 0;
  const mk = String(modelKey).trim();
  if (!mk) return 0;
  try {
    const row = await db
      .prepare(
        `SELECT cost_per_1k_in, cost_per_1k_out
         FROM agentsam_model_catalog
         WHERE model_key = ? AND is_active = 1
         LIMIT 1`,
      )
      .bind(mk)
      .first();
    if (!row) return 0;
    const tin = Math.floor(Number(inputTokens) || 0);
    const tout = Math.floor(Number(outputTokens) || 0);
    return (
      (tin * (Number(row.cost_per_1k_in) || 0)) / 1000 + (tout * (Number(row.cost_per_1k_out) || 0)) / 1000
    );
  } catch {
    return 0;
  }
}

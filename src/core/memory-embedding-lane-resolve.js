/**
 * Runtime SSOT for the memory embed lane — mirrors code-index-lane-resolve.js's
 * pattern (agentsam_routing_arms → agentsam_model_catalog), applied to memory.
 *
 * Deliberate divergence from the code-index resolver:
 *   - Google (Gemini) lane: pgvector SSOT only — no Cloudflare Vectorize binding.
 *   - OpenAI lane: optional legacy Vectorize mirror + pgvector twin when registered.
 *   - pgvector_chunk availability is derived from agentsam_pgvector_lane_registry.
 *
 * D1 is the SSOT. To re-enable OpenAI: flip is_paused/budget_exhausted to 0 on
 * ra_memory_embed_openai_large_ws (and/or drop its priority below Gemini's) — no code
 * change required. See docs/platform/memory-embedding-gemini-lane-2026-08.md.
 */

const CACHE_TTL_MS = 60_000;
/** @type {WeakMap<object, { at: number, config: MemoryEmbeddingLaneConfig }>} */
const cacheByEnv = new WeakMap();

/** OpenAI legacy Vectorize mirror only — Gemini memory lane uses pgvector, not Vectorize (2026-08-22). */
const OPENAI_MEMORY_VECTORIZE = Object.freeze({
  binding: 'AGENTSAM_VECTORIZE_MEMORY',
  index: 'agentsam-memory-oai3large-1536',
});

/** Gemini embedding dimensions — fixed platform standard; no Vectorize binding. */
const GEMINI_MEMORY_DIMENSIONS = 1536;

/**
 * @typedef {object} MemoryEmbeddingLaneConfig
 * @property {'openai'|'google'} provider
 * @property {string} model — bare API model id
 * @property {string} modelKey — catalog/pricing key (may include models/ prefix)
 * @property {number} dimensions — live-verified from the Vectorize binding, not guessed
 * @property {string} version — projection-key version tag
 * @property {string} armId
 * @property {string|null} catalogId
 * @property {string|null} vectorizeBinding — OpenAI legacy only; null for Google/pgvector SSOT
 * @property {string|null} vectorizeIndex
 * @property {boolean} pgvectorAvailable
 * @property {string|null} pgvectorTable
 * @property {number} resolvedAt
 * @property {'d1'} config_source
 */

/** @param {unknown} modelKey */
function normalizeModelKey(modelKey) {
  return String(modelKey || '').trim().replace(/^models\//i, '').toLowerCase();
}

/**
 * @param {any} env
 * @returns {MemoryEmbeddingLaneConfig|null}
 */
export function peekMemoryEmbeddingLaneConfig(env) {
  if (env == null || typeof env !== 'object') return null;
  const hit = cacheByEnv.get(env);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) return null;
  return hit.config;
}

/**
 * Drop cached lane config (after an intentional D1 routing-arm change in-process).
 * @param {any} env
 */
export function clearMemoryEmbeddingLaneConfigCache(env) {
  if (env != null && typeof env === 'object') cacheByEnv.delete(env);
}

/**
 * @param {any} env
 * @param {MemoryEmbeddingLaneConfig} config
 */
function storeCache(env, config) {
  if (env != null && typeof env === 'object') {
    cacheByEnv.set(env, { at: Date.now(), config });
  }
}

/**
 * @param {any} env
 * @returns {Promise<MemoryEmbeddingLaneConfig>}
 */
export async function resolveMemoryEmbeddingLaneConfig(env) {
  const cached = peekMemoryEmbeddingLaneConfig(env);
  if (cached) return cached;

  if (!env?.DB) {
    const e = new Error('memory_embed_lane_resolve_db_required');
    e.code = 'memory_embed_lane_resolve_db_required';
    throw e;
  }

  const arm = await env.DB.prepare(
    `SELECT id, model_key, provider, model_catalog_id, priority
       FROM agentsam_routing_arms
      WHERE task_type = 'memory_embed'
        AND COALESCE(TRIM(workspace_id), '') = ''
        AND COALESCE(is_active, 1) = 1
        AND COALESCE(is_eligible, 1) = 1
        AND COALESCE(is_paused, 0) = 0
        AND COALESCE(budget_exhausted, 0) = 0
      ORDER BY COALESCE(priority, 0) DESC, updated_at DESC
      LIMIT 1`,
  ).first();

  if (!arm?.model_key) {
    const e = new Error('memory_embed_arm_required');
    e.code = 'memory_embed_arm_required';
    throw e;
  }

  const provider = String(arm.provider || '').trim().toLowerCase();
  const model = normalizeModelKey(arm.model_key);
  if (provider !== 'openai' && provider !== 'google') {
    const e = new Error(`memory_embed_provider_unsupported:${provider}`);
    e.code = 'memory_embed_provider_unsupported';
    throw e;
  }

  let catalogModelKey = arm.model_key;
  const catalogId =
    arm.model_catalog_id != null && String(arm.model_catalog_id).trim()
      ? String(arm.model_catalog_id).trim()
      : null;
  if (catalogId) {
    const cat = await env.DB.prepare(
      `SELECT id, model_key, provider
         FROM agentsam_model_catalog
        WHERE id = ? AND COALESCE(is_active, 1) = 1
        LIMIT 1`,
    )
      .bind(catalogId)
      .first();
    if (!cat) {
      const e = new Error(`memory_embed_catalog_missing:${catalogId}`);
      e.code = 'memory_embed_catalog_missing';
      throw e;
    }
    if (String(cat.provider || '').trim().toLowerCase() !== provider) {
      const e = new Error('memory_embed_catalog_provider_mismatch');
      e.code = 'memory_embed_catalog_provider_mismatch';
      throw e;
    }
    catalogModelKey = cat.model_key;
  }

  let dimensions = provider === 'google' ? GEMINI_MEMORY_DIMENSIONS : 1536;
  let vectorizeBinding = null;
  let vectorizeIndex = null;
  if (provider === 'openai') {
    vectorizeBinding = OPENAI_MEMORY_VECTORIZE.binding;
    vectorizeIndex = OPENAI_MEMORY_VECTORIZE.index;
    try {
      const binding = env?.[OPENAI_MEMORY_VECTORIZE.binding];
      if (binding?.describe) {
        const raw = await binding.describe();
        const dims = Number(raw?.dimensions ?? raw?.config?.dimensions);
        if (Number.isFinite(dims) && dims > 0) dimensions = dims;
      }
    } catch {
      /* fall back to the 1536 platform standard */
    }
  }

  // Optional pgvector durability twin — active agentsam_pgvector_lane_registry row for this model.
  let pgvectorTable = null;
  try {
    const pgRows = await env.DB.prepare(
      `SELECT table_name, embedding_model
         FROM agentsam_pgvector_lane_registry
        WHERE purpose = 'memory' AND COALESCE(is_active, 1) = 1`,
    ).all();
    for (const row of pgRows?.results || []) {
      if (normalizeModelKey(row.embedding_model) === model) {
        pgvectorTable = String(row.table_name || '').trim() || null;
        break;
      }
    }
  } catch {
    /* pgvector twin is optional for this lane — resolve without it on read failure */
  }

  const versionTag = `${provider}_${model.replace(/[^a-z0-9]+/g, '')}_${dimensions}_v1`;

  /** @type {MemoryEmbeddingLaneConfig} */
  const config = Object.freeze({
    provider: /** @type {'openai'|'google'} */ (provider),
    model,
    modelKey: String(catalogModelKey || arm.model_key),
    dimensions,
    version: versionTag,
    armId: String(arm.id || ''),
    catalogId,
    vectorizeBinding,
    vectorizeIndex,
    pgvectorAvailable: Boolean(pgvectorTable),
    pgvectorTable,
    resolvedAt: Date.now(),
    config_source: 'd1',
  });

  storeCache(env, config);
  return config;
}

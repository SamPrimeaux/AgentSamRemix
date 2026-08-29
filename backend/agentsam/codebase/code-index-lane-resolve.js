/**
 * Runtime SSOT for sam.codebaseindex PG tables + embed model.
 * Read order: agentsam_pgvector_lane_registry → agentsam_routing_arms → agentsam_model_catalog.
 * Connection transport stays env-only (session pooler write / Hyperdrive retrieve) — not D1.
 */

/** @typedef {{ files: string, chunks: string, symbols: string }} CodeIndexTables */

/**
 * @typedef {object} CodeIndexLaneConfig
 * @property {{ files: string, chunks: string, symbols: string }} tables
 * @property {number} dimensions
 * @property {{ provider: string, model: string, modelKey: string, catalogId: string|null, armId: string, dimensions: number }} embed
 * @property {Record<string, { id: string, table_name: string, dimensions: number, embedding_model: string }>} purposes
 * @property {number} resolvedAt
 * @property {'d1'} config_source — where this routing receipt was loaded from
 * @property {'supabase_pgvector'} vector_store — where embeddings actually live (not D1)
 */

const CACHE_TTL_MS = 60_000;
/** @type {WeakMap<object, { at: number, config: CodeIndexLaneConfig }>} */
const cacheByEnv = new WeakMap();

const PURPOSE_TO_SLOT = Object.freeze({
  codebase: 'chunks',
  codebase_ast_symbols: 'symbols',
  codebase_files: 'files',
});

/** Fixture names for tests only — production must resolve from D1. */
export const CODE_INDEX_LANE_FIXTURE_TABLES = Object.freeze({
  files: 'agentsam_codebase_files_gemini_embedding_2_1536',
  chunks: 'agentsam_codebase_chunks_gemini_embedding_2_1536',
  symbols: 'agentsam_codebase_ast_symbols_gemini_embedding_2_1536',
});

/**
 * @param {unknown} modelKey
 * @returns {string}
 */
export function normalizeCodeIndexEmbedModelKey(modelKey) {
  return String(modelKey || '')
    .trim()
    .replace(/^models\//i, '')
    .toLowerCase();
}

/**
 * @param {any} env
 * @returns {CodeIndexLaneConfig|null}
 */
export function peekCodeIndexLaneConfig(env) {
  if (env == null || typeof env !== 'object') return null;
  const hit = cacheByEnv.get(env);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) return null;
  return hit.config;
}

/**
 * @param {any} env
 * @returns {CodeIndexLaneConfig}
 */
export function requireCodeIndexLaneConfig(env) {
  const cfg = peekCodeIndexLaneConfig(env);
  if (!cfg) {
    const e = new Error('code_index_lane_config_not_resolved');
    e.code = 'code_index_lane_config_not_resolved';
    throw e;
  }
  return cfg;
}

/**
 * Drop cached lane config (tests / after intentional registry change in-process).
 * @param {any} env
 */
export function clearCodeIndexLaneConfigCache(env) {
  if (env != null && typeof env === 'object') cacheByEnv.delete(env);
}

/**
 * @param {any} env
 * @param {CodeIndexLaneConfig} config
 */
function storeCache(env, config) {
  if (env != null && typeof env === 'object') {
    cacheByEnv.set(env, { at: Date.now(), config });
  }
}

/**
 * @param {any} env
 * @returns {Promise<CodeIndexLaneConfig>}
 */
export async function resolveCodeIndexLaneConfig(env) {
  const cached = peekCodeIndexLaneConfig(env);
  if (cached) return cached;

  if (!env?.DB) {
    const e = new Error('code_index_lane_resolve_db_required');
    e.code = 'code_index_lane_resolve_db_required';
    throw e;
  }

  const laneRows = await env.DB.prepare(
    `SELECT id, purpose, schema_name, table_name, dimensions, embedding_model, metric
       FROM agentsam_pgvector_lane_registry
      WHERE purpose IN ('codebase', 'codebase_ast_symbols', 'codebase_files')
        AND COALESCE(is_active, 1) = 1
        AND COALESCE(is_archive, 0) = 0
      ORDER BY purpose`,
  ).all();

  const rows = laneRows?.results || [];
  /** @type {Record<string, { id: string, table_name: string, dimensions: number, embedding_model: string }>} */
  const purposes = {};
  /** @type {Partial<CodeIndexTables>} */
  const tables = {};
  let dimensions = null;
  /** @type {string|null} */
  let registryModel = null;

  for (const row of rows) {
    const purpose = String(row.purpose || '').trim();
    const slot = PURPOSE_TO_SLOT[purpose];
    if (!slot) continue;
    const tableName = String(row.table_name || '').trim();
    if (!tableName || tableName.includes('oai3large') || tableName.includes('_retired_')) {
      const e = new Error(`code_index_lane_registry_invalid_table:${purpose}`);
      e.code = 'code_index_lane_registry_invalid_table';
      throw e;
    }
    const dims = Number(row.dimensions);
    if (!Number.isFinite(dims) || dims <= 0) {
      const e = new Error(`code_index_lane_registry_invalid_dimensions:${purpose}`);
      e.code = 'code_index_lane_registry_invalid_dimensions';
      throw e;
    }
    const embModel = normalizeCodeIndexEmbedModelKey(row.embedding_model);
    if (!embModel) {
      const e = new Error(`code_index_lane_registry_embedding_model_required:${purpose}`);
      e.code = 'code_index_lane_registry_embedding_model_required';
      throw e;
    }
    if (tables[slot]) {
      const e = new Error(`code_index_lane_registry_duplicate_purpose:${purpose}`);
      e.code = 'code_index_lane_registry_duplicate_purpose';
      throw e;
    }
    tables[slot] = tableName;
    purposes[purpose] = {
      id: String(row.id || ''),
      table_name: tableName,
      dimensions: dims,
      embedding_model: embModel,
    };
    if (dimensions == null) dimensions = dims;
    else if (dimensions !== dims) {
      const e = new Error('code_index_lane_registry_dimension_mismatch');
      e.code = 'code_index_lane_registry_dimension_mismatch';
      throw e;
    }
    if (registryModel == null) registryModel = embModel;
    else if (registryModel !== embModel) {
      const e = new Error('code_index_lane_registry_model_mismatch');
      e.code = 'code_index_lane_registry_model_mismatch';
      throw e;
    }
  }

  for (const slot of ['chunks', 'symbols', 'files']) {
    if (!tables[slot]) {
      const e = new Error(`code_index_lane_registry_missing:${slot}`);
      e.code = 'code_index_lane_registry_missing';
      throw e;
    }
  }

  const arm = await env.DB.prepare(
    `SELECT id, model_key, provider, model_catalog_id, priority
       FROM agentsam_routing_arms
      WHERE task_type = 'code_index_embed'
        AND COALESCE(TRIM(workspace_id), '') = ''
        AND COALESCE(is_active, 1) = 1
        AND COALESCE(is_eligible, 1) = 1
        AND COALESCE(is_paused, 0) = 0
        AND COALESCE(budget_exhausted, 0) = 0
      ORDER BY COALESCE(priority, 0) DESC, updated_at DESC
      LIMIT 1`,
  ).first();

  if (!arm?.model_key) {
    const e = new Error('code_index_embed_arm_required');
    e.code = 'code_index_embed_arm_required';
    throw e;
  }

  const armModel = normalizeCodeIndexEmbedModelKey(arm.model_key);
  const armProvider = String(arm.provider || '')
    .trim()
    .toLowerCase();
  if (armProvider && armProvider !== 'google') {
    const e = new Error(`code_index_embed_arm_provider_forbidden:${armProvider}`);
    e.code = 'code_index_embed_arm_provider_forbidden';
    throw e;
  }
  if (armModel !== registryModel) {
    const e = new Error(
      `code_index_lane_arm_model_mismatch:registry=${registryModel}:arm=${armModel}`,
    );
    e.code = 'code_index_lane_arm_model_mismatch';
    throw e;
  }

  let catalogId =
    arm.model_catalog_id != null && String(arm.model_catalog_id).trim()
      ? String(arm.model_catalog_id).trim()
      : null;
  let catalogModelKey = arm.model_key;
  let catalogProvider = armProvider || 'google';

  if (catalogId) {
    const cat = await env.DB.prepare(
      `SELECT id, model_key, provider, api_platform
         FROM agentsam_model_catalog
        WHERE id = ? AND COALESCE(is_active, 1) = 1
        LIMIT 1`,
    )
      .bind(catalogId)
      .first();
    if (!cat) {
      const e = new Error(`code_index_embed_catalog_missing:${catalogId}`);
      e.code = 'code_index_embed_catalog_missing';
      throw e;
    }
    catalogModelKey = cat.model_key;
    catalogProvider = String(cat.provider || catalogProvider)
      .trim()
      .toLowerCase();
    if (normalizeCodeIndexEmbedModelKey(cat.model_key) !== armModel) {
      const e = new Error('code_index_lane_catalog_model_mismatch');
      e.code = 'code_index_lane_catalog_model_mismatch';
      throw e;
    }
    if (catalogProvider && catalogProvider !== 'google') {
      const e = new Error(`code_index_embed_catalog_provider_forbidden:${catalogProvider}`);
      e.code = 'code_index_embed_catalog_provider_forbidden';
      throw e;
    }
  } else {
    const cat = await env.DB.prepare(
      `SELECT id, model_key, provider
         FROM agentsam_model_catalog
        WHERE (model_key = ? OR model_key = ?)
          AND COALESCE(is_active, 1) = 1
        LIMIT 1`,
    )
      .bind(String(arm.model_key), `models/${armModel}`)
      .first();
    if (cat) {
      catalogId = String(cat.id);
      catalogModelKey = cat.model_key;
      catalogProvider = String(cat.provider || catalogProvider)
        .trim()
        .toLowerCase();
    }
  }

  /** @type {CodeIndexLaneConfig} */
  const config = Object.freeze({
    tables: Object.freeze({
      files: tables.files,
      chunks: tables.chunks,
      symbols: tables.symbols,
    }),
    dimensions: /** @type {number} */ (dimensions),
    embed: Object.freeze({
      provider: catalogProvider || 'google',
      model: armModel,
      modelKey: String(catalogModelKey || arm.model_key),
      catalogId,
      armId: String(arm.id),
      dimensions: /** @type {number} */ (dimensions),
    }),
    purposes: Object.freeze(purposes),
    resolvedAt: Date.now(),
    /** D1 registry + arm + catalog — not the vector bytes. */
    config_source: 'd1',
    /** Semantic embeddings live in Supabase agentsam.* pgvector twins. */
    vector_store: 'supabase_pgvector',
  });

  storeCache(env, config);
  return config;
}

/**
 * Embed spec for createAgentsamEmbedding + usage pricing.
 * `model` = API id (bare). `modelKey` = catalog/pricing key (may include models/).
 * @param {CodeIndexLaneConfig} config
 * @returns {{ provider: string, model: string, modelKey: string, dimensions: number, catalogId: string|null, armId: string }}
 */
export function embedSpecFromCodeIndexLaneConfig(config) {
  return {
    provider: config.embed.provider || 'google',
    model: config.embed.model,
    modelKey: config.embed.modelKey || config.embed.model,
    dimensions: config.dimensions,
    catalogId: config.embed.catalogId ?? null,
    armId: config.embed.armId,
  };
}

/**
 * @param {CodeIndexLaneConfig} config
 * @param {unknown} vectorBackendJson string or parsed object from agentsam_code_index_job.vector_backend
 */
export function assertCodeIndexLaneConfigMatchesReceipt(config, vectorBackendJson) {
  let receipt = vectorBackendJson;
  if (typeof receipt === 'string') {
    try {
      receipt = JSON.parse(receipt);
    } catch {
      const e = new Error('code_index_lane_config_drift:invalid_receipt_json');
      e.code = 'code_index_lane_config_drift';
      throw e;
    }
  }
  if (!receipt || typeof receipt !== 'object') {
    const e = new Error('code_index_lane_config_drift:missing_receipt');
    e.code = 'code_index_lane_config_drift';
    throw e;
  }
  const stripSchema = (t) =>
    String(t || '')
      .replace(/^agentsam\./i, '')
      .trim();
  const expect = {
    chunks: stripSchema(receipt.chunks_table),
    symbols: stripSchema(receipt.symbols_table),
    files: stripSchema(receipt.files_table),
  };
  for (const slot of ['chunks', 'symbols', 'files']) {
    if (expect[slot] && expect[slot] !== config.tables[slot]) {
      const e = new Error(
        `code_index_lane_config_drift:${slot}:receipt=${expect[slot]}:live=${config.tables[slot]}`,
      );
      e.code = 'code_index_lane_config_drift';
      throw e;
    }
  }
  const receiptModel = normalizeCodeIndexEmbedModelKey(receipt.embed_model);
  if (receiptModel && receiptModel !== config.embed.model) {
    const e = new Error(
      `code_index_lane_config_drift:embed_model:receipt=${receiptModel}:live=${config.embed.model}`,
    );
    e.code = 'code_index_lane_config_drift';
    throw e;
  }
  return true;
}

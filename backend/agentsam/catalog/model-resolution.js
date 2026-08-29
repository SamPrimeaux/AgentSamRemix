/**
 * agentsam_model_catalog loader — SSOT for ResolvedModel rows.
 * Optional agentsam_ai LEFT JOIN for legacy secret_key_name / timeout overlays only.
 */

import { redirectDeprecatedGoogleModelKey } from './google-model-routes.js';
import { ResolutionError } from './resolve-model-error.js';
import { providerModelIdFromCatalogRow } from './model-identity.js';
import {
  normalizeProvider,
  normalizeApiPlatform,
  KNOWN_PROVIDERS,
} from './resolve-model-platform.js';

/**
 * @typedef {Object} ResolvedModel
 * @property {string}   model_key
 * @property {string}   model_catalog_id
 * @property {string}   provider
 * @property {string}   api_platform
 * @property {string}   routing_lane
 * @property {string}   resolution_source
 * @property {string|null} routing_arm_id
 * @property {string|null} provider_model_id
 * @property {boolean}  supports_tools
 * @property {boolean}  supports_vision
 * @property {boolean}  supports_json_mode
 * @property {boolean}  supports_streaming
 * @property {boolean}  supports_reasoning
 * @property {boolean}  supports_prompt_cache
 * @property {boolean}  supports_thinking
 * @property {number}   context_window
 * @property {number}   max_output_tokens
 * @property {number}   input_price_per_1m
 * @property {number}   cached_input_price_per_1m
 * @property {number}   output_price_per_1m
 * @property {number}   timeout_ms
 * @property {string|null} secret_key_name
 * @property {string|null} reasoning_effort
 */

/**
 * @param {D1Database} db
 * @param {string} model_key
 * @param {string} source
 * @param {string|null} [arm_id]
 * @param {object} [opts]
 */
export async function loadModelRecord(db, model_key, source, arm_id = null, opts = {}) {
  const {
    require_tools = false,
    require_vision = false,
    require_json_mode = false,
  } = opts;

  model_key = redirectDeprecatedGoogleModelKey(model_key);

  const row = await db
    .prepare(
      `
    SELECT
      mc.*,
      mc.id                    AS catalog_id,
      mc.provider              AS catalog_provider,
      mc.api_platform          AS catalog_api_platform,
      mc.effort_default       AS catalog_effort_default,
      mc.effort_param         AS catalog_effort_param,
      ai.secret_key_name,
      ai.default_timeout_ms
    FROM agentsam_model_catalog mc
    LEFT JOIN agentsam_ai ai
      ON ai.model_key = mc.model_key
     AND ai.status    = 'active'
     AND (ai.mode = 'model' OR ai.mode IS NULL)
    WHERE mc.model_key = ?
      AND mc.is_active = 1
    LIMIT 1
  `,
    )
    .bind(model_key)
    .first();

  if (!row) {
    throw new ResolutionError(
      'MODEL_NOT_FOUND',
      `model_key "${model_key}" not found or inactive`,
      { model_key, source },
    );
  }
  if (row.is_degraded) {
    console.warn(`[resolveModel] DEGRADED model=${model_key} reason=${row.degraded_reason}`);
  }
  if (row.budget_exhausted) {
    throw new ResolutionError('BUDGET_EXHAUSTED', `model "${model_key}" budget exhausted`, {
      model_key,
      source,
    });
  }
  if (require_tools && !row.supports_tools) {
    throw new ResolutionError('CAPABILITY_MISMATCH', `${model_key} no tools`, { model_key });
  }
  if (require_vision && !row.supports_vision) {
    throw new ResolutionError('CAPABILITY_MISMATCH', `${model_key} no vision`, { model_key });
  }
  if (require_json_mode && !row.supports_json_mode) {
    throw new ResolutionError('CAPABILITY_MISMATCH', `${model_key} no json_mode`, { model_key });
  }

  const providerRaw = String(row.catalog_provider || '').trim();
  if (!providerRaw) {
    throw new ResolutionError(
      'PROVIDER_REQUIRED',
      `model "${model_key}" has blank agentsam_model_catalog.provider`,
      { model_key, source },
    );
  }
  const provider = normalizeProvider(providerRaw);
  if (!KNOWN_PROVIDERS.has(provider)) {
    throw new ResolutionError(
      'PROVIDER_UNKNOWN',
      `model "${model_key}" has unsupported provider "${providerRaw}" (normalized "${provider}") — ` +
        `use one of: ${[...KNOWN_PROVIDERS].join('|')}`,
      { model_key, source, provider: providerRaw },
    );
  }
  let apiPlatform;
  try {
    apiPlatform = normalizeApiPlatform(row.catalog_api_platform, model_key);
  } catch (err) {
    throw new ResolutionError(
      'API_PLATFORM_REQUIRED',
      err?.message || `model "${model_key}" has invalid api_platform`,
      { model_key, source, catalog_api_platform: row.catalog_api_platform ?? null },
    );
  }

  const inputPer1m = Number(row.cost_per_1k_in || 0) * 1000;
  const outputPer1m = Number(row.cost_per_1k_out || 0) * 1000;
  const cachedPer1m =
    row.cost_per_1k_cached_in != null && Number(row.cost_per_1k_cached_in) > 0
      ? Number(row.cost_per_1k_cached_in) * 1000
      : inputPer1m * 0.1;

  return {
    model_key,
    model_catalog_id: row.catalog_id,
    provider,
    api_platform: apiPlatform,
    routing_lane: row.routing_lane || 'standard',
    resolution_source: source,
    routing_arm_id: arm_id ?? null,
    provider_model_id: providerModelIdFromCatalogRow(row),
    supports_tools: !!row.supports_tools,
    supports_vision: !!row.supports_vision,
    supports_json_mode: !!row.supports_json_mode,
    supports_streaming: !!row.supports_streaming,
    supports_reasoning: !!row.supports_reasoning,
    supports_code_execution: !!row.supports_code_execution,
    supports_prompt_cache: Number(row.cost_per_1k_cached_in || 0) > 0,
    supports_thinking: !!row.supports_reasoning,
    context_window: Number(row.context_window || 0),
    max_output_tokens: Number(row.max_output_tokens || 0),
    input_price_per_1m: inputPer1m,
    cached_input_price_per_1m: cachedPer1m,
    output_price_per_1m: outputPer1m,
    timeout_ms: Number(row.default_timeout_ms || 30000),
    secret_key_name: row.secret_key_name || null,
    effort_default: row.catalog_effort_default || null,
    effort_param: row.catalog_effort_param || null,
    reasoning_effort: row.catalog_effort_default || null,
    avg_latency_p50_ms: row.avg_latency_p50_ms || null,
  };
}

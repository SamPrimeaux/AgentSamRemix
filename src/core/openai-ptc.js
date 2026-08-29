/**
 * OpenAI Responses hosted programmatic_tool_calling (PTC).
 * Gate: feature flag openai_ptc + agentsam_model_catalog.supports_programmatic_tool_calling.
 * Never hardcode model ids — catalog column / cost_notes is SSOT.
 * Fail-closed when catalog capability is missing or 0 (nano rejects PTC with HTTP 400).
 */
import { isFeatureEnabled } from '../../backend/platform/feature-flags.js';
import { loadCatalogCapabilities } from '../../backend/agentsam/catalog/model-capabilities.js';

const FLAG_KEY = 'openai_ptc';

/**
 * @param {any} env
 * @param {string|null|undefined} modelKey
 */
export async function modelSupportsProgrammaticToolCalling(env, modelKey) {
  const mk = modelKey != null ? String(modelKey).trim() : '';
  if (!mk) return false;
  const cap = await loadCatalogCapabilities(env, mk);
  return cap?.supports_programmatic_tool_calling === true;
}

/**
 * Flag (or explicit force) + catalog capability. Fail-closed when catalog says no.
 * @param {any} env
 * @param {{
 *   userId?: string|null,
 *   tenantId?: string|null,
 *   modelKey?: string|null,
 *   force?: boolean,
 * }} opts
 */
export async function shouldInjectProgrammaticToolCalling(env, opts = {}) {
  const flagOn =
    opts.force === true ||
    (await isFeatureEnabled(env, FLAG_KEY, {
      userId: opts.userId,
      tenantId: opts.tenantId,
    }));
  if (!flagOn) return false;
  return modelSupportsProgrammaticToolCalling(env, opts.modelKey);
}

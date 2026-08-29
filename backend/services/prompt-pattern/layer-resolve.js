/**
 * Stable prefix fragments: agentsam_prompt_routes → agentsam_prompt_versions.
 */

import { VOLATILE_PROMPT_LAYER_KEYS } from './contract.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {unknown} raw
 */
export function parsePromptLayerKeys(raw) {
  if (Array.isArray(raw)) return raw.map((k) => trim(k)).filter(Boolean);
  if (raw == null || raw === '') return [];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.map((k) => trim(k)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * @param {Record<string, unknown>|null|undefined} routeRow
 */
export function volatileLayerKeysFromRoute(routeRow) {
  const out = new Set();
  if (!routeRow) return out;
  if (Number(routeRow.include_rag) === 1) out.add('rag');
  if (Number(routeRow.include_recent_memory) === 1) out.add('recent_memory');
  if (Number(routeRow.include_workspace_ctx) === 1) out.add('workspace_ctx');
  if (Number(routeRow.include_active_plan) === 1) out.add('active_plan');
  return out;
}

/**
 * @param {string} layerKey
 * @param {Set<string>} routeVolatile
 */
export function isStablePromptLayerKey(layerKey, routeVolatile = new Set()) {
  const key = trim(layerKey).toLowerCase();
  if (!key) return false;
  if (VOLATILE_PROMPT_LAYER_KEYS.has(key)) return false;
  if (routeVolatile.has(key)) return false;
  return true;
}

/**
 * @param {any} env
 * @param {Record<string, unknown>|null|undefined} routeRow
 * @param {string|null|undefined} tenantId
 */
export async function resolveStablePrefixFragments(env, routeRow, tenantId = null) {
  if (!env?.DB || !routeRow) return [];

  const layerKeys = parsePromptLayerKeys(routeRow.prompt_layer_keys);
  const routeVolatile = volatileLayerKeysFromRoute(routeRow);
  const stableKeys = layerKeys.filter((k) => isStablePromptLayerKey(k, routeVolatile));
  if (!stableKeys.length) stableKeys.push('core_identity');

  /** @type {Array<Record<string, unknown>>} */
  const fragments = [];
  for (const layer_key of stableKeys) {
    try {
      const row = await env.DB.prepare(
        `SELECT id, prompt_key, version, prompt_hash, body_tokens, is_cacheable, min_tokens_for_cache
           FROM agentsam_prompt_versions
          WHERE prompt_key = ?
            AND COALESCE(is_active, 1) = 1
            AND (tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?)
          ORDER BY CASE WHEN tenant_id IS NOT NULL AND tenant_id != '' THEN 0 ELSE 1 END,
                   version DESC
          LIMIT 1`,
      )
        .bind(layer_key, trim(tenantId) || '')
        .first();
      if (!row?.id || !row.prompt_hash) continue;
      fragments.push({
        layer_key,
        prompt_version_id: String(row.id),
        prompt_key: String(row.prompt_key || layer_key),
        prompt_hash: String(row.prompt_hash),
        body_tokens: Math.max(0, Math.floor(Number(row.body_tokens) || 0)),
        is_cacheable: Number(row.is_cacheable) !== 0,
      });
    } catch {
      /* skip layer */
    }
  }
  return fragments;
}

/**
 * Tool catalog generation stamp — single integer identity for agentsam_tools mutations.
 */

import { CATALOG_GENERATION_KV_KEY } from './kv-keys.js';

/**
 * @param {unknown} env
 * @returns {Promise<string>}
 */
export async function resolveToolCatalogGeneration(env) {
  if (!env?.DB) return '0';
  try {
    const row = await env.DB.prepare(
      `SELECT COALESCE(MAX(updated_at), 0) AS gen
         FROM agentsam_tools
        WHERE COALESCE(is_active, 1) = 1`,
    ).first();
    const gen = row?.gen != null ? Number(row.gen) : 0;
    return Number.isFinite(gen) ? String(Math.floor(gen)) : '0';
  } catch {
    return '0';
  }
}

/**
 * Read D1 MAX(updated_at) and mirror to MCP_TOKENS stamp.
 * @param {unknown} env
 */
export async function warmCatalogGenerationStamp(env) {
  const gen = await resolveToolCatalogGeneration(env);
  const kv = env?.KV;
  if (kv && typeof kv.put === 'function') {
    await kv.put(CATALOG_GENERATION_KV_KEY, gen, {
      expirationTtl: 7 * 24 * 60 * 60,
    }).catch(() => {});
  }
  return gen;
}

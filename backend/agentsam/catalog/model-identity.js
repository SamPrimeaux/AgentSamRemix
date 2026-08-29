/**
 * Canonical Agent Sam model identity access.
 *
 * `model_key` is IAM's stable routing/configuration key.
 * `id` is the provider/API model ID after the catalog cutover.
 *
 * During the transition, provider-specific legacy columns are read only as a
 * compatibility fallback. Runtime callers should use this module instead of
 * selecting those columns directly.
 */

const LEGACY_PROVIDER_ID_COLUMNS = Object.freeze({
  anthropic: 'anthropic_model_id',
  openai: 'openai_model_id',
  google: 'google_model_id',
  workers_ai: 'workers_ai_model_id',
  ollama: 'ollama_model_id',
});

function text(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

/**
 * Resolve the provider/API ID from a catalog row.
 *
 * Before cutover this prefers the legacy provider column. After cutover those
 * columns are absent and `id` is the provider/API ID.
 *
 * @param {Record<string, unknown> | null | undefined} row
 * @returns {string|null}
 */
export function providerModelIdFromCatalogRow(row) {
  if (!row) return null;
  const provider = text(row.provider)?.toLowerCase() || '';
  const legacyColumn = LEGACY_PROVIDER_ID_COLUMNS[provider];
  if (legacyColumn && Object.prototype.hasOwnProperty.call(row, legacyColumn)) {
    return text(row[legacyColumn]) || text(row.model_key);
  }
  return text(row.id) || text(row.model_key);
}

/**
 * Load one active catalog row by IAM's stable model key.
 *
 * @param {import('@cloudflare/workers-types').D1Database | null | undefined} db
 * @param {string | null | undefined} modelKey
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function getCatalogRow(db, modelKey) {
  const key = text(modelKey);
  if (!db || !key) return null;
  try {
    return await db
      .prepare(
        `SELECT *
           FROM agentsam_model_catalog
          WHERE model_key = ?
            AND COALESCE(is_active, 1) = 1
          LIMIT 1`,
      )
      .bind(key)
      .first();
  } catch {
    return null;
  }
}

/**
 * Resolve the provider/API model ID for an IAM model key.
 *
 * @param {import('@cloudflare/workers-types').D1Database | null | undefined} db
 * @param {string | null | undefined} modelKey
 * @returns {Promise<string|null>}
 */
export async function getProviderModelId(db, modelKey) {
  return providerModelIdFromCatalogRow(await getCatalogRow(db, modelKey));
}

export { LEGACY_PROVIDER_ID_COLUMNS };

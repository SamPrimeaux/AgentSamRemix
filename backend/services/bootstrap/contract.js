/**
 * Bootstrap v2 contract — deterministic ids and JSON helpers.
 */

export const BOOTSTRAP_POLICY_VERSION = 1;

/** @param {string} workspaceId @param {string} userId */
export function bootstrapRowId(workspaceId, userId) {
  const ws = String(workspaceId || '').trim();
  const uid = String(userId || '').trim();
  if (!ws || !uid) return '';
  return `asb_${ws}_${uid}`.slice(0, 191);
}

/**
 * @param {unknown} raw
 * @param {Record<string, unknown>} fallback
 */
export function parseJsonObject(raw, fallback = {}) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const v = JSON.parse(String(raw));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

/**
 * @param {unknown} raw
 * @param {unknown[]} fallback
 */
export function parseJsonArray(raw, fallback = []) {
  if (raw == null || raw === '') return fallback;
  if (Array.isArray(raw)) return raw;
  try {
    const v = JSON.parse(String(raw));
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

/**
 * @param {unknown} value
 */
export function jsonStable(value) {
  return JSON.stringify(value ?? {});
}

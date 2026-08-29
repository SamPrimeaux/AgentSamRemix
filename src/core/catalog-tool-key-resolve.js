/**
 * Tool key → agentsam_tools.tool_key.
 *
 * Exact match only. No alias / LEGACY redirect tables.
 * Callers and allowlists must use the live catalog tool_key.
 */

/**
 * @param {string} rawKey
 * @returns {string}
 */
export function resolveCatalogDispatchToolKey(rawKey) {
  return String(rawKey ?? '').trim();
}

/**
 * Exact key forms for allowlist compare (raw + lowercase). No invented synonyms.
 * @param {string} rawKey
 * @returns {Set<string>}
 */
export function expandToolKeyAliases(rawKey) {
  const out = new Set();
  const raw = String(rawKey ?? '').trim();
  if (!raw) return out;
  out.add(raw);
  out.add(raw.toLowerCase());
  return out;
}

/**
 * @param {string} toolName
 * @param {Iterable<string>|null|undefined} allowlist
 */
export function allowlistHasTool(toolName, allowlist) {
  if (!allowlist) return false;
  const list = [...allowlist].filter(Boolean);
  if (!list.length) return false;
  const aliases = expandToolKeyAliases(toolName);
  for (const entry of list) {
    for (const a of expandToolKeyAliases(entry)) {
      if (aliases.has(a)) return true;
    }
  }
  return false;
}

/**
 * @param {any} env
 * @param {string} rawKey
 */
export async function loadCatalogToolRowForDispatch(env, rawKey) {
  const raw = String(rawKey ?? '').trim();
  if (!env?.DB || !raw) return null;
  const { loadAgentsamToolRow } = await import('./agentsam-tools-catalog.js');
  return await loadAgentsamToolRow(env, raw);
}

/**
 * Expand OAuth allowlist keys to catalog tool_key values for call-time checks.
 * Exact keys only — row must exist in agentsam_tools when looked up.
 * @param {any} env
 * @param {Iterable<string>} keys
 */
export async function expandOAuthAllowlistKeysToCatalogKeys(env, keys) {
  const out = new Set();
  for (const raw of keys || []) {
    const k = String(raw ?? '').trim().toLowerCase();
    if (!k) continue;
    out.add(k);
    const row = await loadCatalogToolRowForDispatch(env, k);
    if (row?.tool_key) out.add(String(row.tool_key).trim().toLowerCase());
  }
  return out;
}

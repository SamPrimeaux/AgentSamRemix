/**
 * Validate route/profile tool_keys against active agentsam_tools keys (exact match).
 * Pure helpers — pass an activeKeys Set (lowercased tool_key from agentsam_tools).
 */
import { resolveCatalogDispatchToolKey } from './catalog-tool-key-resolve.js';

/** Keys that must stay private (handler-only — never model-facing catalog pins). */
export const EXCALIDRAW_PRIVATE_HANDLER_KEYS = Object.freeze([
  'excalidraw_clear',
  'excalidraw_add_elements',
]);

/**
 * @param {string} rawKey
 * @returns {{ canonical: string, viaAlias: boolean, aliasFrom?: string }}
 */
export function resolveToolKeyWithAlias(rawKey) {
  const raw = String(rawKey ?? '').trim();
  if (!raw) return { canonical: '', viaAlias: false };
  const canonical = resolveCatalogDispatchToolKey(raw) || raw;
  return { canonical, viaAlias: false };
}

/**
 * @param {Iterable<string>} toolKeys
 * @param {Set<string>|Iterable<string>} activeCatalogKeys lowercased active tool_name/tool_key
 * @returns {{
 *   valid: boolean,
 *   unresolvedKeys: string[],
 *   resolvedAliases: Record<string, string>,
 *   privateHandlerLeaks: string[],
 * }}
 */
export function validateToolProfileKeys(toolKeys, activeCatalogKeys) {
  const active = activeCatalogKeys instanceof Set
    ? activeCatalogKeys
    : new Set([...(activeCatalogKeys || [])].map((k) => String(k).trim().toLowerCase()).filter(Boolean));

  const unresolvedKeys = [];
  /** @type {Record<string, string>} */
  const resolvedAliases = {};
  const privateHandlerLeaks = [];

  for (const raw of toolKeys || []) {
    const key = String(raw ?? '').trim();
    if (!key) continue;
    const lower = key.toLowerCase();
    if (EXCALIDRAW_PRIVATE_HANDLER_KEYS.includes(lower)) {
      privateHandlerLeaks.push(key);
      unresolvedKeys.push(key);
      continue;
    }
    const { canonical } = resolveToolKeyWithAlias(key);
    const canonLower = String(canonical).trim().toLowerCase();
    if (!canonLower || !active.has(canonLower)) {
      unresolvedKeys.push(key);
    }
  }

  return {
    valid: unresolvedKeys.length === 0,
    unresolvedKeys,
    resolvedAliases,
    privateHandlerLeaks,
  };
}

/**
 * No catalog redirects — open surface is agentsam_excalidraw only.
 */
export function listExcalidrawOpenAliases() {
  return [];
}

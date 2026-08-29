/**
 * D1-driven tool policy keys (agentsam_tool_policy_keys).
 * Replaces hardcoded Sets for allowlist baselines, cache denylist, MCP panel filters.
 */

/** Tool compilation / route policy must read D1 every request — no isolate cache. */
const POLICY_CACHE_TTL_MS = 0;

function trimKey(v) {
  if (v == null) return '';
  return String(v).trim();
}

/**
 * @param {any} env
 * @param {string} policyKind
 * @param {Set<string>} [fallback]
 * @returns {Promise<Set<string>>}
 */
export async function loadAgentsamToolPolicyKeySet(env, policyKind, fallback = null) {
  const kind = trimKey(policyKind);
  if (!kind) return fallback ? new Set(fallback) : new Set();

  const out = new Set();
  if (env?.DB) {
    try {
      const { results } = await env.DB.prepare(
        `SELECT tool_key FROM agentsam_tool_policy_keys
         WHERE policy_kind = ? AND COALESCE(is_active, 1) = 1
         ORDER BY sort_order ASC, tool_key ASC`,
      )
        .bind(kind)
        .all();
      for (const r of results || []) {
        const k = trimKey(r?.tool_key);
        if (k) out.add(k);
      }
    } catch (e) {
      console.warn('[loadAgentsamToolPolicyKeySet]', kind, e?.message ?? e);
    }
  }

  if (!out.size && fallback?.size) {
    for (const k of fallback) out.add(trimKey(k));
  }

  return out;
}

/** @param {string} [policyKind] */
export function clearAgentsamToolPolicyCache(_policyKind) {
  /* no-op — policy key reads are never cached (POLICY_CACHE_TTL_MS = 0) */
}

/**
 * @param {any} env
 * @param {string} policyKind
 * @param {string} toolKey
 * @param {Set<string>} [fallback]
 */
export async function toolMatchesPolicyKind(env, policyKind, toolKey, fallback = null) {
  const name = trimKey(toolKey);
  if (!name) return false;
  const set = await loadAgentsamToolPolicyKeySet(env, policyKind, fallback);
  return set.has(name);
}

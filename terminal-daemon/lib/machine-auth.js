/**
 * Machine auth — AGENTSAM_BRIDGE_KEY SSOT with EXECOS_KEY legacy alias.
 * Same contract as inneranimalmedia/src/core/bridge-key-auth.js (receive side).
 */

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {Record<string, unknown>|{ AGENTSAM_BRIDGE_KEY?: string, EXECOS_KEY?: string }} env
 * @returns {string[]}
 */
export function configuredMachineAuthSecrets(env) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const k of [env?.AGENTSAM_BRIDGE_KEY, env?.EXECOS_KEY]) {
    const t = trim(k);
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * Outbound hop key: bridge first, then EXECOS_KEY (transition).
 * @param {Record<string, unknown>|{ AGENTSAM_BRIDGE_KEY?: string, EXECOS_KEY?: string }} env
 */
export function resolveOutboundMachineAuthKey(env) {
  return trim(env?.AGENTSAM_BRIDGE_KEY) || trim(env?.EXECOS_KEY) || '';
}

/**
 * @param {string|null|undefined} provided
 * @param {Record<string, unknown>|{ AGENTSAM_BRIDGE_KEY?: string, EXECOS_KEY?: string }} env
 */
export function verifyMachineAuthKey(provided, env) {
  const expected = configuredMachineAuthSecrets(env);
  if (!expected.length) return false;
  const p = trim(provided);
  if (!p) return false;
  return expected.includes(p);
}

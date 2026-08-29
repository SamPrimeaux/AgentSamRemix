/**
 * Outbound auth-header contract for the CMS Cloudflare pipeline adapter.
 * Reads AGENTSAM_BRIDGE_KEY locally so canonical CMS does not import platform auth modules.
 */

function trimKey(env) {
  return env?.AGENTSAM_BRIDGE_KEY == null ? '' : String(env.AGENTSAM_BRIDGE_KEY).trim();
}

/**
 * @param {any} env
 * @returns {string}
 */
export function resolveCmsPipelineAuthKey(env) {
  return trimKey(env);
}

/**
 * @param {any} env
 * @returns {Record<string, string>}
 */
export function cmsPipelineAuthHeaders(env) {
  const key = trimKey(env);
  if (!key) return {};
  return {
    Authorization: `Bearer ${key}`,
    'X-IAM-Service-Key': key,
  };
}

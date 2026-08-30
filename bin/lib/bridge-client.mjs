// SDK candidate: https://github.com/SamPrimeaux/agentsam-sdk/issues/10
// Target after publish: @inneranimalmedia/agentsam-sdk/src/lib/bridge-client.js

const DEFAULT_BASE_URL = 'https://agentsamremix.inneranimalmedia.com';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

export function resolveAgentSamBaseUrl(env = process.env) {
  return trim(env.AGENTSAM_CORE_URL || env.IAM_CORE_URL || env.AGENTSAM_BASE_URL || DEFAULT_BASE_URL)
    .replace(/\/$/, '');
}

export function resolveBridgeKey(env = process.env) {
  return trim(env.AGENTSAM_BRIDGE_KEY);
}

/**
 * Machine-to-machine auth only. Actor/workspace identity is intentionally absent:
 * the service principal authenticates the caller and the server resolves/authorizes
 * the requested resource independently.
 */
export function buildBridgeHeaders(options = {}) {
  const env = options.env || process.env;
  const key = trim(options.key || resolveBridgeKey(env));
  if (!key) throw new Error('AGENTSAM_BRIDGE_KEY_required');

  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
    'X-Bridge-Key': key,
    ...(options.headers || {}),
  };
}

export function createBridgeClient(options = {}) {
  const env = options.env || process.env;
  const baseUrl = trim(options.baseUrl || resolveAgentSamBaseUrl(env)).replace(/\/$/, '');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch_required');

  async function request(pathname, requestOptions = {}) {
    const path = String(pathname || '').startsWith('/') ? pathname : `/${pathname}`;
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...requestOptions,
      headers: buildBridgeHeaders({
        env,
        key: options.key,
        headers: requestOptions.headers,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(String(payload?.error || payload?.message || `HTTP ${response.status}`));
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  return {
    baseUrl,
    get(pathname, requestOptions = {}) {
      return request(pathname, { ...requestOptions, method: 'GET' });
    },
    post(pathname, body, requestOptions = {}) {
      return request(pathname, {
        ...requestOptions,
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      });
    },
  };
}

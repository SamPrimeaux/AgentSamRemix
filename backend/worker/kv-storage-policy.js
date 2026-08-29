/**
 * MCP_TOKENS (env.KV) is for small JSON agent authority derivatives — never screenshots,
 * deploy logs, session state, or binary blobs.
 *
 * SESSION_CACHE is human session + settings context — never MCP permission snapshots.
 *
 * SSOT: docs/platform/kv-lane-ssot-2026-08.md
 */

/** @type {readonly string[]} */
export const KV_BLOCKED_KEY_PREFIXES = ['screenshots/', 'agent_sam:deploy:'];

/** @type {readonly string[]} */
export const KV_BLOCKED_EXACT_KEYS = ['agent_sam:deploy:last_success'];

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isKvScreenshotOrBinaryKey(key) {
  const k = String(key || '').trim();
  if (!k) return false;
  for (const prefix of KV_BLOCKED_KEY_PREFIXES) {
    if (k.startsWith(prefix) || k.includes(`/${prefix}`)) return true;
  }
  for (const exact of KV_BLOCKED_EXACT_KEYS) {
    if (k === exact) return true;
  }
  return false;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function looksLikeBinaryKvValue(value) {
  if (value instanceof ArrayBuffer) return true;
  if (value instanceof Uint8Array) return true;
  if (value instanceof Blob) return true;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return true;
  return false;
}

/**
 * @param {string} key
 * @param {unknown} value
 */
export function assertKvPutAllowed(key, value) {
  if (isKvScreenshotOrBinaryKey(key)) {
    throw new Error(
      `KV (MCP_TOKENS) must not store screenshots or deploy logs. Key "${key}" — use D1 deployments / pwa-build-meta or ephemeral capture APIs.`,
    );
  }
  if (looksLikeBinaryKvValue(value)) {
    throw new Error(
      `KV (MCP_TOKENS) must not store binary data. Key "${key}" — use R2 for images and files.`,
    );
  }
}

/**
 * Wrap env.KV.put/delete guard — does not affect SESSION_CACHE.
 * @param {any} env
 * @returns {any}
 */
export function wrapEnvKvBinding(env) {
  if (!env?.KV?.put) return env;
  const raw = env.KV;
  if (raw.__iamKvGuardWrapped) return env;

  const guarded = {
    __iamKvGuardWrapped: true,
    get: raw.get?.bind(raw),
    getWithMetadata: raw.getWithMetadata?.bind(raw),
    delete: raw.delete?.bind(raw),
    list: raw.list?.bind(raw),
    async put(key, value, options) {
      assertKvPutAllowed(key, value);
      return raw.put(key, value, options);
    },
  };

  return { ...env, KV: guarded };
}

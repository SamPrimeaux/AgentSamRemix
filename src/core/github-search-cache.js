/**
 * Short-lived KV cache for GitHub Search API (code + issues).
 * Survives agent retry loops without re-hitting the 10/min code search cap.
 */
const GITHUB_SEARCH_CACHE_TTL_SEC = 60;

function kvStore(env) {
  return env?.SESSION_CACHE || env?.KV || null;
}

function trim(v) {
  return v == null ? '' : String(v).trim();
}

async function sha256Hex(value) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * @param {string} userId
 * @param {'code'|'issues'} kind
 * @param {string} query
 */
async function githubSearchCacheKey(userId, kind, query) {
  const uid = trim(userId);
  const q = trim(query).toLowerCase();
  const h = (await sha256Hex(`${kind}:${q}`)).slice(0, 24);
  return `gh_search_v1:${uid}:${h}`;
}

/**
 * @param {any} env
 * @param {string} userId
 * @param {'code'|'issues'} kind
 * @param {string} query
 */
export async function readGithubSearchCache(env, userId, kind, query) {
  const store = kvStore(env);
  const uid = trim(userId);
  if (!store?.get || !uid || !trim(query)) return null;
  try {
    const raw = await store.get(await githubSearchCacheKey(uid, kind, query));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * @param {any} env
 * @param {string} userId
 * @param {'code'|'issues'} kind
 * @param {string} query
 * @param {{ success?: boolean, results?: unknown, error?: Record<string, unknown> }} payload
 */
export async function writeGithubSearchCache(env, userId, kind, query, payload) {
  const store = kvStore(env);
  const uid = trim(userId);
  if (!store?.put || !uid || !trim(query)) return;
  try {
    await store.put(
      await githubSearchCacheKey(uid, kind, query),
      JSON.stringify({ ...payload, cached_at: Date.now() }),
      { expirationTtl: GITHUB_SEARCH_CACHE_TTL_SEC },
    );
  } catch {
    /* non-fatal */
  }
}

export { GITHUB_SEARCH_CACHE_TTL_SEC };

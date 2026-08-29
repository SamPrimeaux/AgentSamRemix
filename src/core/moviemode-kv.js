/**
 * MovieMode ephemeral state — prefer SESSION_CACHE (platform standard), fall back to KV.
 * Guards against truthy non-KV bindings (avoids "env.KV.get is not a function").
 */

/** @param {any} env */
export function resolveMoviemodeKv(env) {
  for (const candidate of [env?.SESSION_CACHE, env?.KV]) {
    if (candidate && typeof candidate.get === 'function' && typeof candidate.put === 'function') {
      return candidate;
    }
  }
  return null;
}

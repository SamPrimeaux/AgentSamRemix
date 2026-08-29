/**
 * Transient D1 overload (7429) retry helper for auth-critical paths.
 */

export function isD1OverloadError(err) {
  const msg = String(err?.message ?? err ?? '');
  return /D1 DB is overloaded|queued for too long|\[code:\s*7429\]|7429/.test(msg);
}

export function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ maxAttempts?: number, delays?: number[] }} [opts]
 * @returns {Promise<T>}
 */
export async function withD1Retry(fn, opts = {}) {
  const maxAttempts = Math.max(1, Number(opts.maxAttempts) || 4);
  const delays = Array.isArray(opts.delays) ? opts.delays : [50, 150, 400, 900];
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isD1OverloadError(e) || attempt >= maxAttempts - 1) throw e;
      await sleepMs(delays[attempt] ?? delays[delays.length - 1] ?? 900);
    }
  }
  throw lastErr;
}

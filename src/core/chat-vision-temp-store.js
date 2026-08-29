/**
 * Short-lived chat vision images (temporary_context mode).
 * Stored in SESSION_CACHE — not R2/D1 project assets.
 */

const TEMP_VISION_PREFIX = 'chat_vision_temp:';
const DEFAULT_TTL_SEC = 86400; // 24h

function tempVisionKey(sessionId) {
  return `${TEMP_VISION_PREFIX}${String(sessionId || '').trim()}`;
}

/**
 * @param {any} env
 * @param {string} sessionId
 * @param {Array<{ type: string, source?: { type?: string, media_type?: string, data?: string }, _filename?: string }>} blocks
 * @param {{ ttlSec?: number }} [opts]
 */
export async function storeTemporaryVisionImages(env, sessionId, blocks, opts = {}) {
  if (!env?.SESSION_CACHE || !sessionId || !Array.isArray(blocks) || !blocks.length) return false;
  const payload = {
    stored_at: new Date().toISOString(),
    images: blocks.map(({ _filename, ...block }) => ({
      ...block,
      _filename: _filename || 'image',
    })),
  };
  try {
    await env.SESSION_CACHE.put(tempVisionKey(sessionId), JSON.stringify(payload), {
      expirationTtl: Math.max(3600, Math.min(86400, Number(opts.ttlSec) || DEFAULT_TTL_SEC)),
    });
    return true;
  } catch (e) {
    console.warn('[chat-vision-temp-store] put_failed', e?.message ?? e);
    return false;
  }
}

/**
 * @param {any} env
 * @param {string} sessionId
 */
export async function loadTemporaryVisionImages(env, sessionId) {
  if (!env?.SESSION_CACHE || !sessionId) return [];
  try {
    const raw = await env.SESSION_CACHE.get(tempVisionKey(sessionId), 'json');
    const images = raw?.images;
    return Array.isArray(images) ? images : [];
  } catch {
    return [];
  }
}

/**
 * @param {any} env
 * @param {string} sessionId
 */
export async function clearTemporaryVisionImages(env, sessionId) {
  if (!env?.SESSION_CACHE || !sessionId) return;
  try {
    await env.SESSION_CACHE.delete(tempVisionKey(sessionId));
  } catch {
    /* ignore */
  }
}

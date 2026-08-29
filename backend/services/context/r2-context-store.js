/**
 * Compaction context store — inneranimalmedia-autorag via env.AUTORAG_BUCKET only.
 * Never write compaction artifacts to env.R2 or other buckets.
 *
 * Key schema (strict):
 *   context/{tenantId}/{userId}/{workspaceId}/{conversationId}/{type}_{unixepoch}.json
 *
 * tenantId is the outermost isolation prefix (prevents cross-tenant context bleed).
 * Legacy keys without tenantId segment still readable when full key is stored in D1.
 */

function safePathSegment(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  if (s.includes('/') || s.includes('\\') || s.includes('..')) return null;
  return s;
}

/**
 * @param {{ tenantId: string, userId: string, workspaceId: string, conversationId: string, type: string }} p
 */
export function buildContextR2Key({ tenantId, userId, workspaceId, conversationId, type }) {
  const tid = safePathSegment(tenantId);
  const uid = safePathSegment(userId);
  const wid = safePathSegment(workspaceId);
  const cid = safePathSegment(conversationId);
  const t = safePathSegment(type);
  if (!tid || !uid || !wid || !cid || !t) return null;
  return `context/${tid}/${uid}/${wid}/${cid}/${t}_${Date.now()}.json`;
}

/**
 * @param {object} env Worker env (AUTORAG_BUCKET binding required)
 * @param {{ tenantId: string, userId: string, workspaceId: string, conversationId: string, type: string, content: unknown }} params
 * @returns {Promise<string|null>} Full R2 key on success; null on failure (never throws)
 */
export async function writeContextToR2(env, { tenantId, userId, workspaceId, conversationId, type, content }) {
  try {
    const key = buildContextR2Key({ tenantId, userId, workspaceId, conversationId, type });
    if (!key) {
      console.error('[r2-context-store] invalid key params', {
        tenantId,
        userId,
        workspaceId,
        conversationId,
        type,
      });
      return null;
    }

    const bucket = env.AUTORAG_BUCKET;
    if (!bucket?.put) {
      console.error('[r2-context-store] AUTORAG_BUCKET binding missing');
      return null;
    }

    const body = typeof content === 'string' ? content : JSON.stringify(content ?? null);
    await bucket.put(key, body, { httpMetadata: { contentType: 'application/json' } });
    return key;
  } catch (e) {
    console.error('[r2-context-store] write failed', e?.message ?? e);
    return null;
  }
}

/**
 * @param {object} env Worker env (AUTORAG_BUCKET binding required)
 * @param {string} r2Key Full object key under inneranimalmedia-autorag
 * @returns {Promise<string|null>} Object text or null (never throws)
 */
export async function readContextFromR2(env, r2Key) {
  try {
    const key = String(r2Key ?? '').trim().replace(/^\/+/, '');
    if (!key) return null;

    const bucket = env.AUTORAG_BUCKET;
    if (!bucket?.get) {
      console.error('[r2-context-store] AUTORAG_BUCKET binding missing');
      return null;
    }

    const obj = await bucket.get(key);
    if (!obj) return null;
    return await obj.text();
  } catch (e) {
    console.error('[r2-context-store] read failed', r2Key, e?.message ?? e);
    return null;
  }
}

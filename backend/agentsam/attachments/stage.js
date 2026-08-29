/**
 * Ephemeral binary staging for agent/MCP tools (attachment_id → bytes).
 * Small blobs: SESSION_CACHE (shared with MCP worker).
 * Large blobs: R2 (ARTIFACTS or ASSETS) + meta in SESSION_CACHE.
 * TTL default 1h. Not a durable media library — use agentsam_r2_put + media_assets for that.
 */

const PREFIX = 'agent_att:';
const DEFAULT_TTL_SEC = 3600;
/** Stay under typical KV value comfort; larger → R2 staging. */
const INLINE_MAX_BYTES = 200_000;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const R2_KEY_PREFIX = 'agent-staging';

/**
 * @param {string} id
 */
function stageKey(id) {
  return `${PREFIX}${String(id || '').trim()}`;
}

/**
 * @param {any} env
 * @returns {{ binding: any, bindingName: string } | null}
 */
function resolveStagingR2(env) {
  if (env?.ARTIFACTS?.put) return { binding: env.ARTIFACTS, bindingName: 'ARTIFACTS' };
  if (env?.ASSETS?.put) return { binding: env.ASSETS, bindingName: 'ASSETS' };
  return null;
}

/**
 * @param {any} env
 * @param {string} bindingName
 */
function getStagingR2ByName(env, bindingName) {
  const name = String(bindingName || '').trim();
  if (name && env?.[name]?.get) return env[name];
  return resolveStagingR2(env)?.binding || null;
}

/**
 * @param {any} env
 * @param {Uint8Array|ArrayBuffer|string} bytes
 * @param {{ contentType?: string, filename?: string, workspaceId?: string|null, userId?: string|null, ttlSec?: number }} [meta]
 * @returns {Promise<{ ok: true, attachment_id: string, size: number, content_type: string, filename: string|null, storage: string } | { ok: false, error: string }>}
 */
export async function stageAgentAttachment(env, bytes, meta = {}) {
  if (!env?.SESSION_CACHE?.put) {
    return { ok: false, error: 'session_cache_unavailable' };
  }
  let body;
  if (typeof bytes === 'string') {
    body = new TextEncoder().encode(bytes);
  } else if (bytes instanceof ArrayBuffer) {
    body = new Uint8Array(bytes);
  } else if (bytes instanceof Uint8Array) {
    body = bytes;
  } else {
    return { ok: false, error: 'invalid_bytes' };
  }
  if (!body.byteLength) return { ok: false, error: 'empty_bytes' };
  if (body.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, error: 'file_too_large', max_bytes: MAX_UPLOAD_BYTES };
  }

  const attachmentId = `att_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const ttl = Math.min(Math.max(Number(meta.ttlSec) || DEFAULT_TTL_SEC, 60), 86400);
  const contentType = meta.contentType || 'application/octet-stream';
  const filename = meta.filename || null;
  const workspaceId = meta.workspaceId || null;
  const userId = meta.userId || null;
  const stagedAt = Math.floor(Date.now() / 1000);

  /** @type {Record<string, unknown>} */
  const payload = {
    content_type: contentType,
    filename,
    workspace_id: workspaceId,
    user_id: userId,
    size: body.byteLength,
    staged_at: stagedAt,
    storage: 'inline',
  };

  if (body.byteLength > INLINE_MAX_BYTES) {
    const r2 = resolveStagingR2(env);
    if (!r2) {
      // Fall back to inline if under a soft KV ceiling; otherwise fail loud.
      if (body.byteLength > 900_000) {
        return { ok: false, error: 'staging_r2_unavailable' };
      }
      payload.data_b64 = uint8ToBase64(body);
    } else {
      const wsSeg = String(workspaceId || '_').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
      const r2Key = `${R2_KEY_PREFIX}/${wsSeg}/${attachmentId}`;
      try {
        await r2.binding.put(r2Key, body, {
          httpMetadata: { contentType },
          customMetadata: {
            iam_stage: 'agent_attachment',
            iam_attachment_id: attachmentId,
            ...(workspaceId ? { iam_workspace_id: String(workspaceId) } : {}),
            ...(userId ? { iam_user_id: String(userId) } : {}),
          },
        });
      } catch (e) {
        return { ok: false, error: e?.message || 'staging_r2_put_failed' };
      }
      payload.storage = 'r2';
      payload.r2_binding = r2.bindingName;
      payload.r2_key = r2Key;
    }
  } else {
    payload.data_b64 = uint8ToBase64(body);
  }

  try {
    await env.SESSION_CACHE.put(stageKey(attachmentId), JSON.stringify(payload), {
      expirationTtl: ttl,
    });
    return {
      ok: true,
      attachment_id: attachmentId,
      size: body.byteLength,
      content_type: contentType,
      filename,
      storage: String(payload.storage),
    };
  } catch (e) {
    return { ok: false, error: e?.message || 'stage_failed' };
  }
}

/**
 * Peek meta without consuming bytes.
 * @param {any} env
 * @param {string} attachmentId
 * @param {{ workspaceId?: string|null }} [opts]
 */
export async function peekAgentAttachment(env, attachmentId, opts = {}) {
  if (!env?.SESSION_CACHE?.get) {
    return { ok: false, error: 'session_cache_unavailable' };
  }
  const id = String(attachmentId || '').trim();
  if (!id) return { ok: false, error: 'attachment_id_required' };
  let raw;
  try {
    raw = await env.SESSION_CACHE.get(stageKey(id), 'json');
  } catch {
    return { ok: false, error: 'stage_read_failed' };
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'attachment_not_found' };
  }
  const ws = opts.workspaceId != null ? String(opts.workspaceId).trim() : '';
  if (ws && raw.workspace_id && String(raw.workspace_id) !== ws) {
    return { ok: false, error: 'attachment_workspace_mismatch' };
  }
  return {
    ok: true,
    attachment_id: id,
    content_type: String(raw.content_type || 'application/octet-stream'),
    filename: raw.filename != null ? String(raw.filename) : null,
    size: Number(raw.size) || 0,
    storage: String(raw.storage || (raw.data_b64 ? 'inline' : 'r2')),
    staged_at: Number(raw.staged_at) || null,
  };
}

/**
 * @param {any} env
 * @param {string} attachmentId
 * @param {{ workspaceId?: string|null, consume?: boolean }} [opts]
 * @returns {Promise<{ ok: true, bytes: Uint8Array, contentType: string, filename: string|null } | { ok: false, error: string }>}
 */
export async function takeAgentAttachment(env, attachmentId, opts = {}) {
  if (!env?.SESSION_CACHE?.get) {
    return { ok: false, error: 'session_cache_unavailable' };
  }
  const id = String(attachmentId || '').trim();
  if (!id) return { ok: false, error: 'attachment_id_required' };
  let raw;
  try {
    raw = await env.SESSION_CACHE.get(stageKey(id), 'json');
  } catch {
    return { ok: false, error: 'stage_read_failed' };
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'attachment_not_found' };
  }
  const ws = opts.workspaceId != null ? String(opts.workspaceId).trim() : '';
  if (ws && raw.workspace_id && String(raw.workspace_id) !== ws) {
    return { ok: false, error: 'attachment_workspace_mismatch' };
  }

  let bytes = new Uint8Array(0);
  const storage = String(raw.storage || (raw.data_b64 ? 'inline' : 'r2'));
  if (storage === 'r2' && raw.r2_key) {
    const binding = getStagingR2ByName(env, String(raw.r2_binding || ''));
    if (!binding?.get) {
      return { ok: false, error: 'staging_r2_unavailable' };
    }
    try {
      const obj = await binding.get(String(raw.r2_key));
      if (!obj) return { ok: false, error: 'attachment_r2_missing' };
      const ab = await obj.arrayBuffer();
      bytes = new Uint8Array(ab);
    } catch {
      return { ok: false, error: 'attachment_r2_read_failed' };
    }
  } else {
    bytes = base64ToUint8(String(raw.data_b64 || ''));
  }

  if (!bytes.byteLength) return { ok: false, error: 'attachment_empty' };

  if (opts.consume !== false) {
    if (env.SESSION_CACHE.delete) {
      try {
        await env.SESSION_CACHE.delete(stageKey(id));
      } catch {
        /* non-fatal */
      }
    }
    if (storage === 'r2' && raw.r2_key) {
      const binding = getStagingR2ByName(env, String(raw.r2_binding || ''));
      if (binding?.delete) {
        try {
          await binding.delete(String(raw.r2_key));
        } catch {
          /* non-fatal — TTL / lifecycle can clean */
        }
      }
    }
  }

  return {
    ok: true,
    bytes,
    contentType: String(raw.content_type || 'application/octet-stream'),
    filename: raw.filename != null ? String(raw.filename) : null,
  };
}

/** @param {Uint8Array} u8 */
function uint8ToBase64(u8) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** @param {string} b64 */
function base64ToUint8(b64) {
  const cleaned = String(b64 || '').replace(/\s/g, '');
  if (!cleaned) return new Uint8Array(0);
  const bin = atob(cleaned);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Decode optional MCP inline base64 (content_base64 or data URL).
 * @param {string} raw
 * @returns {{ bytes: Uint8Array, contentType: string|null } | null}
 */
export function decodeInlineBase64Content(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const dataUrl = /^data:([^;]+);base64,(.+)$/i.exec(s);
  if (dataUrl) {
    return { bytes: base64ToUint8(dataUrl[2]), contentType: dataUrl[1] || null };
  }
  try {
    const bytes = base64ToUint8(s);
    if (!bytes.byteLength) return null;
    return { bytes, contentType: null };
  } catch {
    return null;
  }
}

/**
 * Parse staged_attachment_ids from chat multipart / JSON body.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseStagedAttachmentIds(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x || '').trim()).filter((id) => id.startsWith('att_'));
  }
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) {
        return arr.map((x) => String(x || '').trim()).filter((id) => id.startsWith('att_'));
      }
    } catch {
      /* fall through */
    }
  }
  return s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter((id) => id.startsWith('att_'));
}

export const AGENT_ATTACHMENT_INLINE_MAX_BYTES = INLINE_MAX_BYTES;
export const AGENT_ATTACHMENT_MAX_BYTES = MAX_UPLOAD_BYTES;

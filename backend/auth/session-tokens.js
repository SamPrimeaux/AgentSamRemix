/**
 * Edge-verified IAM browser session tokens (HS256 JWT in HttpOnly cookie).
 * Hot path: verify signature + exp + KV revocation — no D1 per request.
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const EDGE_SESSION_TOKEN_VERSION = 1;
export const IAM_SESSION_REVOKED_KV_PREFIX = 'iam_sess_revoked_v1:';
export const IAM_AUTH_REV_KV_PREFIX = 'iam_auth_rev_v1:';

function b64urlEncodeJson(obj) {
  const bytes = textEncoder.encode(JSON.stringify(obj));
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlEncodeBytes(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(value) {
  const base64 = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    + '==='.slice((String(value || '').length + 3) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function trimField(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/** @param {any} env */
export function sessionSigningSecret(env) {
  return trimField(env?.SESSION_SIGNING_SECRET) || '';
}

export function assertSessionSigningConfigured(env) {
  if (!sessionSigningSecret(env)) {
    throw new Error('session_signing_secret_required');
  }
}

/** @param {any} env */
async function importSigningKey(env) {
  const secret = sessionSigningSecret(env);
  if (!secret) return null;
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** JWT-shaped token (three dot-separated segments). */
export function isEdgeSessionToken(value) {
  const s = trimField(value);
  if (!s) return false;
  const parts = s.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

/** Legacy opaque auth_sessions.id (UUID). */
export function isLegacySessionId(value) {
  const s = trimField(value);
  if (!s || isEdgeSessionToken(s)) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

/**
 * @param {any} env
 * @param {{
 *   sessionId: string,
 *   userId: string,
 *   tenantId?: string | null,
 *   workspaceId?: string | null,
 *   email?: string | null,
 *   personUuid?: string | null,
 *   displayName?: string | null,
 *   authRev?: number,
 *   ttlSec?: number,
 * }} input
 * @returns {Promise<string | null>}
 */
export async function mintEdgeSessionToken(env, input) {
  const key = await importSigningKey(env);
  if (!key) return null;

  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.min(
    Math.max(Number(input.ttlSec) || 30 * 24 * 60 * 60, 60),
    30 * 24 * 60 * 60,
  );
  const payload = {
    v: EDGE_SESSION_TOKEN_VERSION,
    sid: trimField(input.sessionId),
    sub: trimField(input.userId),
    tid: trimField(input.tenantId),
    wid: trimField(input.workspaceId),
    email: trimField(input.email),
    pid: trimField(input.personUuid),
    dn: trimField(input.displayName),
    rev: Number.isFinite(Number(input.authRev)) ? Number(input.authRev) : 0,
    iat: now,
    exp: now + ttl,
  };

  if (!payload.sid || !payload.sub) return null;

  const header = { alg: 'HS256', typ: 'JWT' };
  const signingInput = `${b64urlEncodeJson(header)}.${b64urlEncodeJson(payload)}`;
  const sig = await crypto.subtle.sign('HMAC', key, textEncoder.encode(signingInput));
  return `${signingInput}.${b64urlEncodeBytes(new Uint8Array(sig))}`;
}

/**
 * @param {any} env
 * @param {string} token
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function verifyEdgeSessionToken(env, token) {
  const raw = trimField(token);
  if (!raw || !isEdgeSessionToken(raw)) return null;

  const key = await importSigningKey(env);
  if (!key) return null;

  const parts = raw.split('.');
  const signingInput = `${parts[0]}.${parts[1]}`;
  let providedSig;
  try {
    providedSig = b64urlDecode(parts[2]);
  } catch {
    return null;
  }

  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    providedSig,
    textEncoder.encode(signingInput),
  );
  if (!ok) return null;

  let payload;
  try {
    payload = JSON.parse(textDecoder.decode(b64urlDecode(parts[1])));
  } catch {
    return null;
  }

  if (Number(payload?.v) !== EDGE_SESSION_TOKEN_VERSION) return null;
  if (payload?.exp && Date.now() / 1000 > Number(payload.exp)) return null;
  if (!trimField(payload?.sid) || !trimField(payload?.sub)) return null;
  return payload;
}

/**
 * Normalize verified JWT claims to getSession() payload shape.
 * @param {Record<string, unknown>} claims
 */
export function edgeClaimsToSessionPayload(claims) {
  return {
    v: 1,
    edge: true,
    session_id: trimField(claims.sid),
    user_id: trimField(claims.sub),
    tenant_id: trimField(claims.tid),
    workspace_id: trimField(claims.wid),
    person_uuid: trimField(claims.pid ?? claims.pn),
    email: trimField(claims.email),
    display_name: trimField(claims.dn),
    auth_rev: Number.isFinite(Number(claims.rev)) ? Number(claims.rev) : 0,
    expires_at: claims.exp ? new Date(Number(claims.exp) * 1000).toISOString() : null,
    edge_claims: claims,
  };
}

/**
 * @param {any} env
 * @param {string} sessionId
 * @param {number} [ttlSec]
 */
export async function markSessionRevokedInKv(env, sessionId, ttlSec = 86400) {
  const sid = trimField(sessionId);
  const kv = env?.SESSION_CACHE;
  if (!sid || !kv?.put) return;
  const ttl = Math.max(60, Math.min(Number(ttlSec) || 86400, 30 * 24 * 60 * 60));
  try {
    await kv.put(`${IAM_SESSION_REVOKED_KV_PREFIX}${sid}`, '1', { expirationTtl: ttl });
  } catch {
    /* non-fatal */
  }
}

/** @param {any} env @param {string} sessionId */
export async function isSessionRevokedInKv(env, sessionId) {
  const sid = trimField(sessionId);
  const kv = env?.SESSION_CACHE;
  if (!sid || !kv?.get) return false;
  try {
    const v = await kv.get(`${IAM_SESSION_REVOKED_KV_PREFIX}${sid}`);
    return v != null && String(v).trim() !== '';
  } catch {
    return false;
  }
}

/** @param {any} env @param {string} userId @param {number} rev */
export async function syncAuthRevCache(env, userId, rev) {
  const uid = trimField(userId);
  const kv = env?.SESSION_CACHE;
  if (!uid || !kv?.put) return;
  const n = Number.isFinite(Number(rev)) ? Number(rev) : 0;
  try {
    await kv.put(`${IAM_AUTH_REV_KV_PREFIX}${uid}`, String(n), { expirationTtl: 7 * 24 * 60 * 60 });
  } catch {
    /* non-fatal */
  }
}

/** @param {any} env @param {string} userId */
export async function readAuthRevFromCache(env, userId) {
  const uid = trimField(userId);
  const kv = env?.SESSION_CACHE;
  if (!uid || !kv?.get) return null;
  try {
    const raw = await kv.get(`${IAM_AUTH_REV_KV_PREFIX}${uid}`);
    if (raw == null || String(raw).trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * @param {any} env
 * @param {string} rawCookieValue
 * @returns {Promise<{ sessionId: string | null, claims: Record<string, unknown> | null, legacy: boolean }>}
 */
export async function resolveSessionFromCookieValue(env, rawCookieValue) {
  const raw = trimField(rawCookieValue);
  if (!raw) return { sessionId: null, claims: null, legacy: false };

  if (isEdgeSessionToken(raw)) {
    const claims = await verifyEdgeSessionToken(env, raw);
    if (!claims) return { sessionId: null, claims: null, legacy: false };
    return { sessionId: trimField(claims.sid), claims, legacy: false };
  }

  if (isLegacySessionId(raw)) {
    return { sessionId: raw, claims: null, legacy: true };
  }

  return { sessionId: raw, claims: null, legacy: true };
}

/** @param {string} token @param {number} [maxAgeSec] */
export function buildSessionSetCookieHeader(token, maxAgeSec = 30 * 24 * 60 * 60) {
  const value = encodeURIComponent(String(token || ''));
  const maxAge = Math.max(0, Math.floor(Number(maxAgeSec) || 0));
  return `session=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

/**
 * SESSION_CACHE writes for user working context, prefs, and UI flags.
 */

import {
  legacySessionKvKey,
  sessionContextKey,
  sessionKvKey,
  sessionPrefsKey,
  sessionUiFlagsKey,
} from './kv-keys.js';

export const SESSION_CTX_TTL_SECONDS = 14 * 24 * 60 * 60;
export const SESSION_PREFS_TTL_SECONDS = 60 * 60;
export const SESSION_UI_FF_TTL_SECONDS = 120;

/**
 * @param {unknown} env
 */
function sessionCache(env) {
  const cache = env?.SESSION_CACHE;
  if (cache && typeof cache.get === 'function' && typeof cache.put === 'function') return cache;
  return null;
}

/**
 * @param {unknown} raw
 */
function parseJson(raw) {
  if (raw == null || raw === '') return null;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

/**
 * Dual-write canonical + legacy session keys.
 * @param {unknown} env
 * @param {string} sessionId
 * @param {Record<string, unknown>} payload
 * @param {number} ttlSec
 */
export async function putSessionKvPayload(env, sessionId, payload, ttlSec) {
  const cache = sessionCache(env);
  const id = String(sessionId || '').trim();
  if (!cache || !id) return false;
  const json = JSON.stringify(payload);
  const ttl = Math.max(300, Number(ttlSec) || 86400);
  const keys = [sessionKvKey(id), legacySessionKvKey(id)].filter(Boolean);
  try {
    await Promise.all(keys.map((key) => cache.put(key, json, { expirationTtl: ttl })));
    return true;
  } catch (e) {
    console.debug('[session-context-kv] session put failed', id, e?.message ?? e);
    return false;
  }
}

/**
 * @param {unknown} env
 * @param {string} sessionId
 */
export async function getSessionKvPayload(env, sessionId) {
  const cache = sessionCache(env);
  const id = String(sessionId || '').trim();
  if (!cache || !id) return null;
  for (const key of [sessionKvKey(id), legacySessionKvKey(id)]) {
    try {
      const raw = await cache.get(key);
      const parsed = parseJson(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * @param {unknown} env
 * @param {string} sessionId
 */
export async function deleteSessionKvPayload(env, sessionId) {
  const cache = sessionCache(env);
  const id = String(sessionId || '').trim();
  if (!cache?.delete || !id) return;
  for (const key of [sessionKvKey(id), legacySessionKvKey(id)]) {
    try {
      await cache.delete(key);
    } catch {
      /* non-fatal */
    }
  }
}

/**
 * @param {unknown} env
 * @param {{ userId: string, patch: Record<string, unknown> }} p
 */
export async function patchSessionContextCache(env, p) {
  const cache = sessionCache(env);
  const uid = String(p.userId || '').trim();
  if (!cache || !uid) return false;
  const key = sessionContextKey(uid);
  if (!key) return false;
  let existing = {};
  try {
    existing = parseJson(await cache.get(key)) || {};
  } catch {
    existing = {};
  }
  const body = {
    ...existing,
    ...p.patch,
    user_id: uid,
    updated_at_unix: Math.floor(Date.now() / 1000),
  };
  try {
    await cache.put(key, JSON.stringify(body), { expirationTtl: SESSION_CTX_TTL_SECONDS });
    return true;
  } catch (e) {
    console.debug('[session-context-kv] ctx put failed', key, e?.message ?? e);
    return false;
  }
}

/**
 * @param {unknown} env
 * @param {{ userId: string, workspaceId: string, preferences: Record<string, unknown> }} p
 */
export async function putSessionPrefsCache(env, p) {
  const cache = sessionCache(env);
  const uid = String(p.userId || '').trim();
  const ws = String(p.workspaceId || '').trim();
  if (!cache || !uid || !ws) return false;
  const key = sessionPrefsKey(uid, ws);
  const body = {
    user_id: uid,
    workspace_id: ws,
    preferences: p.preferences ?? {},
    updated_at_unix: Math.floor(Date.now() / 1000),
  };
  try {
    await cache.put(key, JSON.stringify(body), { expirationTtl: SESSION_PREFS_TTL_SECONDS });
    return true;
  } catch (e) {
    console.debug('[session-context-kv] prefs put failed', key, e?.message ?? e);
    return false;
  }
}

/**
 * @param {unknown} env
 * @param {{ userId: string, workspaceId: string, uiFlags: Record<string, boolean> }} p
 */
export async function putSessionUiFlagsCache(env, p) {
  const cache = sessionCache(env);
  const uid = String(p.userId || '').trim();
  const ws = String(p.workspaceId || '').trim();
  if (!cache || !uid || !ws) return false;
  const key = sessionUiFlagsKey(uid, ws);
  const body = {
    user_id: uid,
    workspace_id: ws,
    ui_flags: p.uiFlags ?? {},
    updated_at_unix: Math.floor(Date.now() / 1000),
  };
  try {
    await cache.put(key, JSON.stringify(body), { expirationTtl: SESSION_UI_FF_TTL_SECONDS });
    return true;
  } catch (e) {
    console.debug('[session-context-kv] ui ff put failed', key, e?.message ?? e);
    return false;
  }
}

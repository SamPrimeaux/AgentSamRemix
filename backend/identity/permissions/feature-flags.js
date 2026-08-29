/**
 * Edge-cached feature flags — global + per-user layers, 60s TTL.
 * Hot path: JWT snapshot (session token) or KV merged cache — never live D1 per request.
 */

export const FEATURE_FLAGS_TTL_SEC = 60;
export const FF_GLOBAL_KV_KEY = 'ff_global_v1';
export const FF_USER_OVERRIDES_KV_PREFIX = 'ff_user_v1:';
export const FF_MERGED_KV_PREFIX = 'ff_merged_v1:';

function trimId(v) {
  if (v == null) return '';
  return String(v).trim();
}

function kv(env) {
  return env?.SESSION_CACHE || null;
}

function mergeFeatureFlags(globalEnabled, userOverrides) {
  const out = {};
  for (const [k, v] of Object.entries(globalEnabled || {})) {
    if (v) out[k] = true;
  }
  for (const [k, v] of Object.entries(userOverrides || {})) {
    out[k] = Number(v) === 1;
  }
  return out;
}

/** @param {Record<string, boolean>} flags */
export function compactFeatureFlagsForJwt(flags) {
  const out = {};
  for (const [k, v] of Object.entries(flags || {})) {
    if (!k) continue;
    out[k] = v ? 1 : 0;
  }
  return out;
}

/** @param {Record<string, number> | null | undefined} ff */
export function expandFeatureFlagsFromJwt(ff) {
  if (!ff || typeof ff !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(ff)) {
    if (!k) continue;
    out[k] = Number(v) === 1;
  }
  return out;
}

async function readKvEntry(cache, key, ttlSec) {
  try {
    const raw = await cache.get(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.ts === 'number' &&
      Date.now() - parsed.ts < ttlSec * 1000
    ) {
      return parsed.data;
    }
  } catch {
    /* cold cache */
  }
  return undefined;
}

async function writeKvEntry(cache, key, data, ttlSec) {
  try {
    await cache.put(key, JSON.stringify({ data, ts: Date.now() }), {
      expirationTtl: Math.max(ttlSec * 2, 120),
    });
  } catch {
    /* non-fatal */
  }
}

async function loadGlobalFeatureFlagsFromD1(env) {
  const out = {};
  if (!env?.DB) return out;
  const nowSec = Math.floor(Date.now() / 1000);
  const gRes = await env.DB.prepare(
    `SELECT flag_key FROM agentsam_feature_flag
     WHERE enabled_globally = 1
       AND COALESCE(is_archived, 0) = 0
       AND (expires_at IS NULL OR expires_at > ?)`,
  )
    .bind(nowSec)
    .all();
  for (const r of gRes.results || []) {
    if (r?.flag_key != null && String(r.flag_key).trim() !== '') {
      out[String(r.flag_key)] = true;
    }
  }
  return out;
}

async function loadUserFeatureOverridesFromD1(env, userId) {
  const out = {};
  const uid = trimId(userId);
  if (!uid || !env?.DB) return out;
  const oRes = await env.DB.prepare(
    `SELECT flag_key, enabled FROM agentsam_user_feature_override WHERE user_id = ?`,
  )
    .bind(uid)
    .all();
  for (const r of oRes.results || []) {
    if (r?.flag_key != null && String(r.flag_key).trim() !== '') {
      out[String(r.flag_key)] = Number(r.enabled) === 1;
    }
  }
  return out;
}

async function writeFeatureFlagCaches(env, userId, merged, globalEnabled, userOverrides, workspaceId = '') {
  const cache = kv(env);
  if (!cache?.put) return;
  const uid = trimId(userId);
  const ws = trimId(workspaceId);
  await writeKvEntry(cache, FF_GLOBAL_KV_KEY, globalEnabled, FEATURE_FLAGS_TTL_SEC);
  if (uid) {
    await writeKvEntry(cache, `${FF_USER_OVERRIDES_KV_PREFIX}${uid}`, userOverrides, FEATURE_FLAGS_TTL_SEC);
    await writeKvEntry(cache, `${FF_MERGED_KV_PREFIX}${uid}`, merged, FEATURE_FLAGS_TTL_SEC);
    await writeKvEntry(cache, `ff:${uid}`, merged, FEATURE_FLAGS_TTL_SEC);
    if (ws) {
      const { putSessionUiFlagsCache } = await import('../../services/session-context/kv-cache.js');
      await putSessionUiFlagsCache(env, { userId: uid, workspaceId: ws, uiFlags: merged });
    }
  }
}

/** @param {any} env */
export async function loadGlobalFeatureFlagsCached(env) {
  const cache = kv(env);
  if (cache?.get) {
    const hit = await readKvEntry(cache, FF_GLOBAL_KV_KEY, FEATURE_FLAGS_TTL_SEC);
    if (hit !== undefined) return hit;
  }
  const globalEnabled = await loadGlobalFeatureFlagsFromD1(env);
  if (cache?.put) {
    await writeKvEntry(cache, FF_GLOBAL_KV_KEY, globalEnabled, FEATURE_FLAGS_TTL_SEC);
  }
  return globalEnabled;
}

/** @param {any} env @param {string} userId */
export async function loadUserFeatureOverridesCached(env, userId) {
  const uid = trimId(userId);
  if (!uid) return {};
  const cache = kv(env);
  const key = `${FF_USER_OVERRIDES_KV_PREFIX}${uid}`;
  if (cache?.get) {
    const hit = await readKvEntry(cache, key, FEATURE_FLAGS_TTL_SEC);
    if (hit !== undefined) return hit;
  }
  const overrides = await loadUserFeatureOverridesFromD1(env, uid);
  if (cache?.put) {
    await writeKvEntry(cache, key, overrides, FEATURE_FLAGS_TTL_SEC);
  }
  return overrides;
}

/**
 * KV-only hot path for legacy sessions (no JWT snapshot).
 * @param {any} env
 * @param {string} userId
 * @param {string} [_tenantId]
 * @returns {Promise<Record<string, boolean>>}
 */
export async function loadFeatureFlagsCached(env, userId, _tenantId) {
  void _tenantId;
  const uid = trimId(userId);
  if (!uid) return {};

  const cache = kv(env);
  const mergedKey = `${FF_MERGED_KV_PREFIX}${uid}`;
  if (cache?.get) {
    const hit = await readKvEntry(cache, mergedKey, FEATURE_FLAGS_TTL_SEC);
    if (hit !== undefined) return hit;
  }

  const [globalEnabled, userOverrides] = await Promise.all([
    loadGlobalFeatureFlagsCached(env),
    loadUserFeatureOverridesCached(env, uid),
  ]);
  const merged = mergeFeatureFlags(globalEnabled, userOverrides);
  await writeFeatureFlagCaches(env, uid, merged, globalEnabled, userOverrides);
  return merged;
}

/**
 * Refresh from D1 — login mint, admin writes, explicit bust paths only.
 * @param {any} env
 * @param {string} userId
 */
export async function loadFeatureFlagsFromD1(env, userId, _tenantId) {
  void _tenantId;
  const uid = trimId(userId);
  if (!uid || !env?.DB) return {};
  const [globalEnabled, userOverrides] = await Promise.all([
    loadGlobalFeatureFlagsFromD1(env),
    loadUserFeatureOverridesFromD1(env, uid),
  ]);
  const merged = mergeFeatureFlags(globalEnabled, userOverrides);
  let workspaceId = '';
  try {
    const row = await env.DB.prepare(
      `SELECT active_workspace_id FROM auth_users WHERE id = ? LIMIT 1`,
    )
      .bind(uid)
      .first();
    workspaceId = trimId(row?.active_workspace_id);
  } catch {
    workspaceId = '';
  }
  await writeFeatureFlagCaches(env, uid, merged, globalEnabled, userOverrides, workspaceId);
  return merged;
}

/** Back-compat export — same as cached loader (never forces D1 unless cache miss). */
export async function loadFeatureFlags(env, userId, tenantId) {
  return loadFeatureFlagsCached(env, userId, tenantId);
}

/** @param {any} env @param {string} [userId] */
export async function invalidateFeatureFlagsCache(env, userId) {
  const cache = kv(env);
  if (!cache?.delete) return;
  const uid = trimId(userId);
  const keys = uid
    ? [
        `${FF_MERGED_KV_PREFIX}${uid}`,
        `${FF_USER_OVERRIDES_KV_PREFIX}${uid}`,
        `ff:${uid}`,
      ]
    : [];
  for (const key of keys) {
    try {
      await cache.delete(key);
    } catch {
      /* non-fatal */
    }
  }
}

/** Call when global agentsam_feature_flag rows change. */
export async function invalidateGlobalFeatureFlagsCache(env) {
  const cache = kv(env);
  if (!cache?.delete) return;
  try {
    await cache.delete(FF_GLOBAL_KV_KEY);
  } catch {
    /* non-fatal */
  }
}

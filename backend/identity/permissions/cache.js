/**
 * KV-fronted caches for mutable auth claims (membership, policy, auth_rev).
 * D1 is touched only on cache miss or explicit refresh — not on every request.
 */

import { loadMembership } from '../workspace/membership.js';
import { loadAgentSamUserPolicy } from './user-policy.js';
import { syncAuthRevCache, readAuthRevFromCache } from '../../auth/session-tokens.js';

const MEMBERSHIP_TTL_SEC = 300;
const POLICY_TTL_SEC = 300;

function trimId(v) {
  if (v == null) return '';
  return String(v).trim();
}

function kv(env) {
  return env?.SESSION_CACHE || null;
}

/**
 * @param {any} env
 * @param {string} userId
 * @param {string} workspaceId
 */
export async function loadMembershipCached(env, userId, workspaceId) {
  const uid = trimId(userId);
  const wid = trimId(workspaceId);
  if (!uid || !wid) return null;

  const cache = kv(env);
  const key = `auth_mem_v1:${uid}:${wid}`;
  if (cache?.get) {
    try {
      const raw = await cache.get(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.ts === 'number' && Date.now() - parsed.ts < MEMBERSHIP_TTL_SEC * 1000) {
          return parsed.membership ?? null;
        }
      }
    } catch {
      /* cold cache */
    }
  }

  const membership = await loadMembership(env, uid, wid);
  if (cache?.put) {
    try {
      await cache.put(
        key,
        JSON.stringify({ membership, ts: Date.now() }),
        { expirationTtl: MEMBERSHIP_TTL_SEC * 2 },
      );
    } catch {
      /* non-fatal */
    }
  }
  return membership;
}

/**
 * @param {any} env
 * @param {string} userId
 * @param {string} workspaceId
 */
export async function loadAgentSamUserPolicyCached(env, userId, workspaceId = '') {
  const uid = trimId(userId);
  const ws = trimId(workspaceId);
  if (!uid) return null;

  const cache = kv(env);
  const key = `auth_pol_v1:${uid}:${ws || '_'}`;
  if (cache?.get) {
    try {
      const raw = await cache.get(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.ts === 'number' && Date.now() - parsed.ts < POLICY_TTL_SEC * 1000) {
          return parsed.policy ?? null;
        }
      }
    } catch {
      /* cold cache */
    }
  }

  const policy = await loadAgentSamUserPolicy(env, uid, ws);
  if (cache?.put) {
    try {
      await cache.put(
        key,
        JSON.stringify({ policy, ts: Date.now() }),
        { expirationTtl: POLICY_TTL_SEC * 2 },
      );
    } catch {
      /* non-fatal */
    }
  }
  return policy;
}

/** @param {any} env @param {string} userId @param {string} [workspaceId] */
export async function invalidateAuthClaimsCache(env, userId, workspaceId = '') {
  const uid = trimId(userId);
  const cache = kv(env);
  if (!uid || !cache?.delete) return;
  const ws = trimId(workspaceId);
  const keys = ws
    ? [`auth_mem_v1:${uid}:${ws}`, `auth_pol_v1:${uid}:${ws}`]
    : [];
  for (const key of keys) {
    try {
      await cache.delete(key);
    } catch {
      /* non-fatal */
    }
  }
}

/**
 * Read auth_users.auth_rev (with KV fronting). Used at login + permission bumps.
 * @param {any} env
 * @param {string} userId
 */
export async function readAuthRev(env, userId) {
  const uid = trimId(userId);
  if (!uid || !env?.DB) return 0;

  const cached = await readAuthRevFromCache(env, uid);
  if (cached != null) return cached;

  try {
    const row = await env.DB.prepare(
      `SELECT COALESCE(auth_rev, 0) AS auth_rev FROM auth_users WHERE id = ? LIMIT 1`,
    )
      .bind(uid)
      .first();
    const rev = Number(row?.auth_rev);
    const out = Number.isFinite(rev) ? rev : 0;
    await syncAuthRevCache(env, uid, out);
    return out;
  } catch {
    return 0;
  }
}

/**
 * Bump auth_rev to invalidate all outstanding edge session tokens for a user.
 * @param {any} env
 * @param {string} userId
 */
export async function bumpAuthRev(env, userId) {
  const uid = trimId(userId);
  if (!uid || !env?.DB) return 0;
  try {
    await env.DB.prepare(
      `UPDATE auth_users
       SET auth_rev = COALESCE(auth_rev, 0) + 1, updated_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(uid)
      .run();
    const rev = await readAuthRev(env, uid);
    await syncAuthRevCache(env, uid, rev);
    await invalidateAuthClaimsCache(env, uid);
    return rev;
  } catch (e) {
    console.warn('[bumpAuthRev]', e?.message ?? e);
    return 0;
  }
}

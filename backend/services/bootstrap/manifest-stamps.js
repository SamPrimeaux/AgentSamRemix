/**
 * Tiny generation stamps for conversation manifest cache validation.
 * Avoids full bootstrap / D1 profile / MAX(agentsam_tools) on cache-hit turns.
 */

import { getMcpPermPointer } from './kv-cache.js';
import { warmCatalogGenerationStamp } from './catalog-generation.js';
import {
  CATALOG_GENERATION_KV_KEY,
  PROFILE_GENERATION_KV_PREFIX,
} from './kv-keys.js';

/**
 * @param {string} profileKey
 */
export function profileGenerationKvKey(profileKey) {
  const key = String(profileKey || '').trim();
  if (!key) return '';
  return `${PROFILE_GENERATION_KV_PREFIX}${key}`;
}

/**
 * @param {unknown} env
 */
export async function readCatalogGenerationStamp(env) {
  const kv = env?.KV;
  if (kv && typeof kv.get === 'function') {
    try {
      const cached = await kv.get(CATALOG_GENERATION_KV_KEY);
      if (cached != null && String(cached).trim() !== '') {
        return String(cached).trim();
      }
    } catch {
      /* fall through */
    }
  }
  return warmCatalogGenerationStamp(env);
}

/**
 * @param {unknown} env
 * @param {string} userId
 * @param {string} workspaceId
 */
export async function readActorContextHashFromPointer(env, userId, workspaceId) {
  const uid = String(userId || '').trim();
  const ws = String(workspaceId || '').trim();
  if (!uid || !ws) return '';
  const pointer = await getMcpPermPointer(env, uid, ws);
  return pointer?.context_hash != null ? String(pointer.context_hash).trim() : '';
}

/**
 * @param {unknown} db
 * @param {string} profileTaskType
 */
async function loadProfileGenerationFromD1(db, profileTaskType) {
  const mode = String(profileTaskType || '').trim().toLowerCase();
  if (!db?.prepare || !mode) return '';
  try {
    const row = await db
      .prepare(
        `SELECT p.profile_key, p.updated_at AS profile_updated_at, b.updated_at AS binding_updated_at
         FROM agentsam_tool_profile_bindings b
         JOIN agentsam_tool_profiles p ON p.profile_key = b.profile_key AND COALESCE(p.is_active, 1) = 1
         WHERE b.task_type = ? AND COALESCE(b.is_active, 1) = 1
         ORDER BY b.priority ASC
         LIMIT 1`,
      )
      .bind(mode)
      .first();
    if (row?.profile_key) {
      return `${String(row.profile_key)}:${Number(row.binding_updated_at) || 0}:${Number(row.profile_updated_at) || 0}`;
    }
  } catch {
    /* ignore */
  }
  try {
    const row = await db
      .prepare(
        `SELECT profile_key, updated_at FROM agentsam_tool_profiles
         WHERE profile_key = 'default_route' AND COALESCE(is_active, 1) = 1 LIMIT 1`,
      )
      .first();
    if (row?.profile_key) {
      return `default_route:0:${Number(row.updated_at) || 0}`;
    }
  } catch {
    /* ignore */
  }
  return '';
}

/**
 * @param {unknown} env
 * @param {string} profileTaskType
 */
export async function readProfileGenerationStamp(env, profileTaskType) {
  const mode = String(profileTaskType || '').trim().toLowerCase();
  if (!mode) return '';

  const d1Gen = await loadProfileGenerationFromD1(env?.DB, mode);
  if (!d1Gen) return '';

  const kv = env?.KV;
  const kvKey = profileGenerationKvKey(d1Gen.split(':')[0] || mode);
  if (kv && kvKey && typeof kv.get === 'function') {
    try {
      const cached = await kv.get(kvKey);
      if (cached != null && String(cached).trim() !== '') {
        return String(cached).trim();
      }
    } catch {
      /* ignore */
    }
  }

  if (kv && kvKey && typeof kv.put === 'function') {
    await kv.put(kvKey, d1Gen, { expirationTtl: 7 * 24 * 60 * 60 }).catch(() => {});
  }
  return d1Gen;
}

/**
 * Warm profile stamp after bootstrap compile.
 * @param {unknown} env
 * @param {{ profileKey?: string|null, profileRevision?: string|null }} p
 */
export async function warmProfileGenerationStamp(env, p = {}) {
  const profileKey = String(p.profileKey || '').trim();
  const revision = String(p.profileRevision || '').trim();
  if (!profileKey || !revision || !env?.KV) return revision;
  const kvKey = profileGenerationKvKey(profileKey);
  const stamp = `${profileKey}:${revision}`;
  await env.KV.put(kvKey, stamp, { expirationTtl: 7 * 24 * 60 * 60 }).catch(() => {});
  return stamp;
}

/**
 * Cheap manifest identity reads for cache-hit validation (KV-only for actor/catalog when warm).
 * @param {unknown} env
 * @param {{ userId?: string|null, workspaceId?: string|null, profileTaskType?: string|null }} scope
 */
export async function readManifestGenerationStamps(env, scope = {}) {
  const userId = String(scope.userId || '').trim();
  const workspaceId = String(scope.workspaceId || '').trim();
  const profileTaskType = String(scope.profileTaskType || '').trim().toLowerCase();

  const [actorContextHash, catalogGeneration, profileGeneration] = await Promise.all([
    userId && workspaceId ? readActorContextHashFromPointer(env, userId, workspaceId) : Promise.resolve(''),
    readCatalogGenerationStamp(env),
    profileTaskType ? readProfileGenerationStamp(env, profileTaskType) : Promise.resolve(''),
  ]);

  return { actorContextHash, catalogGeneration, profileGeneration };
}

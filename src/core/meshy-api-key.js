/**
 * Resolve Meshy API key: user BYOK (Settings → Keys) then platform MESHYAI_API_KEY.
 */
import { getUserBYOKey } from '../../backend/identity/provisioning/byok.js';
import { fetchAuthUserTenantId } from './auth.js';
import { meshyApiKey } from './meshy-api.js';

/** @param {string | null | undefined} key */
export function isMeshyKeyStub(key) {
  const k = String(key || '').trim();
  return !k || k.startsWith('sk-meshy-stub') || k === 'stub';
}

/** @param {{ apiKey?: string | null; source?: string } | null | undefined} auth */
export function isMeshyAuthMissing(auth) {
  return !auth?.apiKey || isMeshyKeyStub(auth.apiKey);
}

/**
 * @param {any} env
 * @param {{ userId?: string; user_id?: string; tenant_id?: string; tenantId?: string }} ctx
 * @param {{ keySource?: 'byok' | 'platform' | null }} [opts]
 * @returns {Promise<{ apiKey: string | null; source: 'byok' | 'platform' | 'none' }>}
 */
export async function resolveMeshyAuth(env, ctx, opts = {}) {
  const userId = String(ctx?.userId || ctx?.user_id || '').trim();
  let tenantId = String(ctx?.tenant_id || ctx?.tenantId || '').trim();
  const keySource = opts.keySource || null;

  if (userId && !tenantId && env?.DB) {
    try {
      tenantId = String(await fetchAuthUserTenantId(env, userId) || '').trim();
    } catch {
      /* BYOK lookup may still fall through to platform key */
    }
  }

  if (keySource === 'platform') {
    const apiKey = meshyApiKey(env);
    return {
      apiKey: isMeshyKeyStub(apiKey) ? null : apiKey,
      source: isMeshyKeyStub(apiKey) ? 'none' : 'platform',
    };
  }

  if (keySource === 'byok') {
    if (!userId || !tenantId) return { apiKey: null, source: 'none' };
    const byok = await getUserBYOKey(env, userId, tenantId, 'meshy');
    const apiKey = byok?.key ? String(byok.key).trim() : '';
    return {
      apiKey: isMeshyKeyStub(apiKey) ? null : apiKey,
      source: isMeshyKeyStub(apiKey) ? 'none' : 'byok',
    };
  }

  if (userId && tenantId) {
    const byok = await getUserBYOKey(env, userId, tenantId, 'meshy');
    const byokKey = byok?.key ? String(byok.key).trim() : '';
    if (byokKey && !isMeshyKeyStub(byokKey)) {
      return { apiKey: byokKey, source: 'byok' };
    }
  }

  const platformKey = meshyApiKey(env);
  if (platformKey && !isMeshyKeyStub(platformKey)) {
    return { apiKey: platformKey, source: 'platform' };
  }

  return { apiKey: null, source: 'none' };
}

/** @param {Record<string, unknown> | null | undefined} job */
export function meshyKeySourceFromJob(job) {
  try {
    if (job?.texture_data) {
      const td = JSON.parse(String(job.texture_data));
      if (td.meshy_key_source === 'byok' || td.meshy_key_source === 'platform') {
        return td.meshy_key_source;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * @param {Record<string, unknown> | null | undefined} job
 * @param {Record<string, unknown>} patch
 */
export function mergeJobTextureData(job, patch) {
  /** @type {Record<string, unknown>} */
  let base = {};
  try {
    if (job?.texture_data) base = JSON.parse(String(job.texture_data));
  } catch {
    /* ignore */
  }
  return JSON.stringify({ ...base, ...patch });
}

/**
 * @param {Record<string, unknown> | null | undefined} existing
 * @param {'byok' | 'platform'} source
 * @param {Record<string, unknown>} [extra]
 */
export function textureDataWithMeshySource(existing, source, extra = {}) {
  /** @type {Record<string, unknown>} */
  let base = {};
  if (typeof existing === 'string') {
    try {
      base = JSON.parse(existing);
    } catch {
      base = {};
    }
  } else if (existing && typeof existing === 'object') {
    base = { ...existing };
  }
  return { ...base, ...extra, meshy_key_source: source };
}

/**
 * KV dirty flags for /api/overview/dashboard-bundle — written by Supabase webhooks,
 * consumed on bundle fetch so the dashboard can refresh without waiting for the 120s poll.
 */

export const OVERVIEW_BUNDLE_KV_PREFIX = 'overview:bundle:dirty';

/** @typedef {'deploy' | 'errors' | 'workflows' | 'plans'} OverviewDirtySection */

/** @type {OverviewDirtySection[]} */
export const OVERVIEW_DIRTY_SECTIONS = ['deploy', 'errors', 'workflows', 'plans'];

/**
 * @param {OverviewDirtySection} section
 * @param {string} [tenantId]
 */
export function overviewBundleDirtyKey(section, tenantId) {
  const tid = String(tenantId || 'global').trim() || 'global';
  return `${OVERVIEW_BUNDLE_KV_PREFIX}:${section}:${tid}`;
}

/**
 * @param {any} env
 * @param {OverviewDirtySection} section
 * @param {string} [tenantId]
 */
/**
 * @param {string|null|undefined} value
 * @param {Record<string, unknown>|null|undefined} [metadata]
 * @returns {number|null} age in seconds, or null if unknown
 */
export function overviewBundleDirtyAgeSeconds(value, metadata) {
  if (value == null || value === '') return null;
  let setAt = null;
  try {
    const j = JSON.parse(String(value));
    if (j && typeof j === 'object' && j.set_at != null) {
      const n = Number(j.set_at);
      if (Number.isFinite(n) && n > 0) setAt = n;
    }
  } catch {
    const n = Number(String(value).trim());
    if (Number.isFinite(n) && n > 1_000_000_000_000) setAt = n;
  }
  if (setAt == null && metadata && metadata.set_at != null) {
    const n = Number(metadata.set_at);
    if (Number.isFinite(n) && n > 0) setAt = n;
  }
  if (setAt == null) return null;
  return Math.max(0, Math.floor((Date.now() - setAt) / 1000));
}

export async function setOverviewBundleDirty(env, section, tenantId) {
  if (!env?.KV?.put) return;
  const key = overviewBundleDirtyKey(section, tenantId);
  const setAt = Date.now();
  try {
    await env.KV.put(key, JSON.stringify({ set_at: setAt }), {
      expirationTtl: 60 * 30,
      metadata: { set_at: setAt },
    });
  } catch (e) {
    console.debug('[overview-bundle-kv] set failed', key, e?.message ?? e);
  }
}

/**
 * Read dirty flag without clearing (for health probes).
 * @param {any} env
 * @param {OverviewDirtySection} section
 * @param {string} [tenantId]
 * @returns {Promise<{ set: boolean, age_seconds?: number }>}
 */
export async function readOverviewBundleDirtyFlag(env, section, tenantId) {
  if (!env?.KV?.get) return { set: false };
  const key = overviewBundleDirtyKey(section, tenantId);
  try {
    let value = null;
    /** @type {Record<string, unknown>|null} */
    let metadata = null;
    if (typeof env.KV.getWithMetadata === 'function') {
      const row = await env.KV.getWithMetadata(key);
      value = row?.value ?? null;
      metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : null;
    } else {
      value = await env.KV.get(key);
    }
    if (value == null || value === '') return { set: false };
    const age = overviewBundleDirtyAgeSeconds(value, metadata);
    return age != null ? { set: true, age_seconds: age } : { set: true };
  } catch (e) {
    console.debug('[overview-bundle-kv] read failed', key, e?.message ?? e);
    return { set: false };
  }
}

/**
 * Read and clear dirty section flags for a tenant (plus global fallbacks).
 * @param {any} env
 * @param {string} [tenantId]
 * @returns {Promise<OverviewDirtySection[]>}
 */
export async function consumeOverviewBundleDirtyFlags(env, tenantId) {
  if (!env?.KV?.get) return [];
  const tid = String(tenantId || '').trim();
  const dirty = /** @type {OverviewDirtySection[]} */ ([]);
  for (const section of OVERVIEW_DIRTY_SECTIONS) {
    const keys = [overviewBundleDirtyKey(section, tid), overviewBundleDirtyKey(section, 'global')];
    for (const key of keys) {
      try {
        const v = await env.KV.get(key);
        if (v != null && v !== '') {
          if (!dirty.includes(section)) dirty.push(section);
          await env.KV.delete(key).catch(() => {});
        }
      } catch {
        /* non-fatal */
      }
    }
  }
  return dirty;
}

/**
 * Map Supabase webhook table + event to overview dirty section(s).
 * @param {string} table
 * @param {string} type
 * @returns {OverviewDirtySection[]}
 */
export function overviewDirtySectionsForWebhook(table, type) {
  const t = String(table || '').toLowerCase();
  const ev = String(type || '').toUpperCase();
  if (t === 'build_deploy_events' && ev === 'INSERT') return ['deploy'];
  if (t === 'agentsam_error_events' && ev === 'INSERT') return ['errors'];
  if (t === 'agentsam_workflow_runs' && (ev === 'INSERT' || ev === 'UPDATE')) return ['workflows'];
  if (t === 'agentsam_plan_tasks' && (ev === 'INSERT' || ev === 'UPDATE')) return ['plans'];
  return [];
}

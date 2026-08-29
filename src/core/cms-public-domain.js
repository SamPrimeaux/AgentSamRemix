/**
 * CMS public storefront host — D1 tenants, workspace deploy_url, Cloudflare Workers domains.
 * No slug→domain maps or workers.dev guesses in application code.
 */
import { cfApi } from './customer-cloudflare-dispatch.js';
import { resolveWorkspaceBindings } from '../../backend/identity/workspace/agentsam-workspace.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function normalizeHost(raw) {
  return trim(raw)
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .split('/')[0]
    .toLowerCase();
}

function hostnameFromUrl(raw) {
  const url = trim(raw);
  if (!url) return null;
  try {
    return normalizeHost(new URL(url.startsWith('http') ? url : `https://${url}`).hostname);
  } catch {
    return null;
  }
}

const WORKER_DOMAINS_CACHE_KEY = 'cf:worker_domains_by_service:v1';
const WORKER_DOMAINS_TTL_SEC = 300;

/**
 * @param {any} env
 * @returns {Promise<Record<string, string>|null>}
 */
async function loadWorkerDomainsByService(env) {
  if (env?.SESSION_CACHE) {
    try {
      const cached = await env.SESSION_CACHE.get(WORKER_DOMAINS_CACHE_KEY, { type: 'json' });
      if (cached && typeof cached === 'object') return cached;
    } catch (_) {}
  }

  const token = trim(env?.CLOUDFLARE_API_TOKEN);
  const accountId = trim(env?.CLOUDFLARE_ACCOUNT_ID);
  if (!token || !accountId) return null;

  try {
    const rows = await cfApi(token, `/accounts/${encodeURIComponent(accountId)}/workers/domains`);
    /** @type {Record<string, string>} */
    const byService = {};
    for (const row of rows || []) {
      const service = trim(row?.service);
      const host = normalizeHost(row?.hostname);
      if (!service || !host) continue;
      const existing = byService[service];
      if (!existing || (existing.startsWith('www.') && !host.startsWith('www.'))) {
        byService[service] = host;
      }
    }
    if (env?.SESSION_CACHE) {
      await env.SESSION_CACHE.put(WORKER_DOMAINS_CACHE_KEY, JSON.stringify(byService), {
        expirationTtl: WORKER_DOMAINS_TTL_SEC,
      }).catch(() => {});
    }
    return byService;
  } catch (e) {
    console.warn('[cms-public-domain] worker_domains', e?.message ?? e);
    return null;
  }
}

/**
 * @param {any} env
 * @param {string|null|undefined} workerName
 */
async function resolveHostFromCloudflareWorker(env, workerName) {
  const name = trim(workerName);
  if (!name) return null;
  const index = await loadWorkerDomainsByService(env);
  return index?.[name] || null;
}

/**
 * Resolve live public hostname for a CMS project slug.
 * @param {any} env
 * @param {string|null|undefined} projectSlug
 * @param {{ workspaceId?: string|null, workerName?: string|null, useCloudflareApi?: boolean }} [opts]
 * @returns {Promise<{ domain: string, source: string }|null>}
 */
export async function resolveCmsSitePublicDomain(env, projectSlug, opts = {}) {
  const slug = trim(projectSlug);
  if (!env || !slug) return null;

  const { resolveCmsTenantByProjectSlug, cmsTenantPublicDomain } = await import('./cms-tenant-resolve.js');
  const tenant = await resolveCmsTenantByProjectSlug(env, slug);
  const fromTenant = cmsTenantPublicDomain(tenant);
  if (fromTenant) {
    return { domain: normalizeHost(fromTenant), source: 'cms_tenants' };
  }

  let bindings = null;
  try {
    bindings = await resolveWorkspaceBindings(env, slug);
  } catch (_) {}

  const deployHost = hostnameFromUrl(bindings?.deployUrl);
  if (deployHost) {
    return { domain: deployHost, source: 'agentsam_workspace.deploy_url' };
  }

  const metaHost = normalizeHost(bindings?.metadata?.public_domain || bindings?.metadata?.publicDomain);
  if (metaHost) {
    return { domain: metaHost, source: 'agentsam_workspace.metadata' };
  }

  const workerName = trim(opts.workerName) || trim(bindings?.workerName);
  if (workerName && opts.useCloudflareApi !== false) {
    const fromCf = await resolveHostFromCloudflareWorker(env, workerName);
    if (fromCf) {
      return { domain: fromCf, source: 'cloudflare_workers_domains' };
    }
  }

  return null;
}

/**
 * @param {string|null|undefined} domain
 */
export function normalizeCmsPublicHost(domain) {
  const host = normalizeHost(domain);
  return host || null;
}

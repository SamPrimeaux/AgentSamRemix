/**
 * CMS project + workspace context — resolved per user via agentsam_bootstrap + D1.
 * Never hardcode operator project slugs as fallbacks.
 */
import { resolveActiveBootstrap, resolveBootstrapWorkspaceContext } from '../../../../../backend/identity/bootstrap.js';
import { ensureUserBootstrapRow } from '../../../bootstrap-scoped-context.js';
import { cmsBootstrapKey } from '../bootstrap/cache-key.js';
import { mergeOperatorHubSites, sortCmsHubSites, isOperatorCmsHubWorkspace } from './hub-sites.js';
import {
  loadCmsProjectUiPreferences,
  saveCmsProjectUiPreferences,
} from './cms-project-preferences.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function parseJsonSafe(raw, fallback = {}) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

/** @param {unknown} raw */
export function normalizeCmsSitesResponse(raw) {
  if (Array.isArray(raw)) return raw.filter((s) => s && trim(s.slug));
  if (raw && typeof raw === 'object') {
    const vals = Object.values(raw);
    if (vals.length && vals.every((v) => v && typeof v === 'object' && trim(v.slug))) return vals;
  }
  return [];
}

/**
 * True when agentsam_project_context has active cms_site rows for this workspace.
 * @param {any} env
 * @param {string} workspaceId
 */
export async function hasRegisteredCmsSiteContext(env, workspaceId) {
  const ws = trim(workspaceId);
  if (!env?.DB || !ws) return false;
  try {
    const row = await env.DB.prepare(
      `SELECT 1 AS ok
         FROM agentsam_project_context
        WHERE workspace_id = ? AND project_type = 'cms_site' AND COALESCE(status, 'active') = 'active'
        LIMIT 1`,
    )
      .bind(ws)
      .first();
    return !!row?.ok;
  } catch (_) {
    return false;
  }
}

/**
 * @param {Record<string, unknown>|null|undefined} bootstrapRow
 */
export function readBootstrapCmsProjectSlug(bootstrapRow) {
  if (!bootstrapRow) return null;
  const prefs = parseJsonSafe(bootstrapRow.ui_preferences_json, {});
  return trim(prefs.cms_project_slug) || null;
}

/**
 * @param {any} env
 * @param {{ tenantId: string, workspaceId: string }} scope
 */
export async function listCmsSitesForScope(env, { tenantId, workspaceId }) {
  const tid = trim(tenantId);
  const ws = trim(workspaceId);
  if (!env?.DB || !tid || !ws) return [];

  const bySlug = new Map();

  const addSite = (slug, meta = {}) => {
    const key = trim(slug);
    if (!key) return;
    const prev = bySlug.get(key) || {};
    bySlug.set(key, {
      slug: key,
      name: trim(meta.name) || trim(meta.project_name) || key,
      domain: trim(meta.domain) || null,
      logo_url: trim(meta.logo_url) || trim(prev.logo_url) || null,
      primary_color: trim(meta.primary_color) || trim(prev.primary_color) || null,
      page_count: Number(meta.page_count) || prev.page_count || 0,
      updated_at: meta.updated_at || prev.updated_at || null,
      source: meta.source || prev.source || 'unknown',
      target_workspace_id: trim(meta.target_workspace_id) || trim(prev.target_workspace_id) || null,
      is_featured: meta.is_featured ?? prev.is_featured ?? false,
      hub_priority: Number(meta.hub_priority) || Number(prev.hub_priority) || 0,
      cms_hosting: trim(meta.cms_hosting) || trim(prev.cms_hosting) || null,
    });
  };

  let hasWorkspaceRegistry = false;
  try {
    const { results: ctxRows } = await env.DB.prepare(
      `SELECT project_key, project_name, priority, notes
         FROM agentsam_project_context
        WHERE workspace_id = ? AND project_type = 'cms_site' AND COALESCE(status, 'active') = 'active'
        ORDER BY COALESCE(priority, 0) DESC, project_name, project_key`,
    )
      .bind(ws)
      .all();
    hasWorkspaceRegistry = (ctxRows || []).length > 0;
    for (const row of ctxRows || []) {
      const notes = parseJsonSafe(row.notes, {});
      addSite(row.project_key, {
        name: row.project_name,
        source: 'agentsam_project_context',
        target_workspace_id: trim(notes.target_workspace_id) || null,
        cms_hosting: trim(notes.cms_hosting) || null,
        hub_priority: Number(row.priority) || 0,
        is_featured: notes.hub_launcher === true,
      });
    }
  } catch (_) {}

  // Always merge tenant + page-derived sites — registry rows may omit the operator's primary tenant.
  try {
    const { results: tenantSites } = await env.DB.prepare(
      `SELECT slug, name, domain
         FROM cms_tenants
        WHERE tenant_ref_id = ? AND COALESCE(is_active, 1) = 1
        ORDER BY name, slug`,
    )
      .bind(tid)
      .all();
    for (const row of tenantSites || []) {
      addSite(row.slug, { name: row.name, domain: row.domain, source: 'cms_tenants' });
    }
  } catch (_) {}

  try {
    const { results: pageProjects } = await env.DB.prepare(
      `SELECT project_slug AS slug, COUNT(*) AS page_count, MAX(updated_at) AS updated_at
         FROM cms_pages
        WHERE tenant_id = ?
          AND status != 'archived'
          AND trim(COALESCE(project_slug, '')) != ''
          AND (workspace_id = ? OR workspace_id IS NULL OR trim(workspace_id) = '')
        GROUP BY project_slug
        ORDER BY project_slug`,
    )
      .bind(tid, ws)
      .all();
    for (const row of pageProjects || []) {
      addSite(row.slug, {
        page_count: Number(row.page_count) || 0,
        updated_at: row.updated_at,
        source: 'cms_pages',
      });
    }
  } catch (_) {}

  if (!hasWorkspaceRegistry) {
    try {
      const wsRow = await env.DB.prepare(
        `SELECT slug, name FROM workspaces WHERE id = ? LIMIT 1`,
      )
        .bind(ws)
        .first();
      const wsSlug = trim(wsRow?.slug);
      if (wsSlug && !bySlug.has(wsSlug)) {
        const tenant = await env.DB.prepare(
          `SELECT slug, name, domain FROM cms_tenants WHERE slug = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
        )
          .bind(wsSlug)
          .first()
          .catch(() => null);
        if (tenant) {
          addSite(tenant.slug, {
            name: tenant.name,
            domain: tenant.domain,
            source: 'workspace_slug',
          });
        }
      }
    } catch (_) {}
  }

  await mergeOperatorHubSites(env, ws, bySlug);

  const sites = [...bySlug.values()];
  const slugsNeedingCounts = sites.filter((s) => !(Number(s.page_count) > 0)).map((s) => s.slug);
  if (slugsNeedingCounts.length > 0) {
    try {
      const placeholders = slugsNeedingCounts.map(() => '?').join(',');
      const { results: countRows } = await env.DB.prepare(
        `SELECT project_slug, COUNT(*) AS n, MAX(updated_at) AS updated_at
           FROM cms_pages
          WHERE status != 'archived'
            AND project_slug IN (${placeholders})
          GROUP BY project_slug`,
      )
        .bind(...slugsNeedingCounts)
        .all();
      const countBySlug = new Map((countRows || []).map((r) => [trim(r.project_slug), r]));
      for (const site of sites) {
        const row = countBySlug.get(site.slug);
        if (!row) continue;
        site.page_count = Number(row.n) || site.page_count || 0;
        site.updated_at = site.updated_at || row.updated_at || null;
      }
    } catch (_) {}
  }

  await hydrateSiteDomainsFromTenants(env, sites);
  return sites;
}

/**
 * Registry rows from agentsam_project_context often lack domain — hydrate from cms_tenants (D1).
 * @param {any} env
 * @param {Array<{ slug: string, domain?: string|null, source?: string }>} sites
 */
async function hydrateSiteDomainsFromTenants(env, sites) {
  if (!env?.DB || !sites?.length) return;
  const { loadCmsTenantIndex, resolveCmsTenantByProjectSlug } = await import('./tenant-context.js');
  const index = await loadCmsTenantIndex(env);

  for (const site of sites) {
    const slug = trim(site.slug);
    if (!slug) continue;
    const tenant = await resolveCmsTenantByProjectSlug(env, slug, index);
    if (!tenant) continue;
    if (!trim(site.domain)) {
      site.domain = trim(tenant.domain) || site.domain || null;
    }
    if (!trim(site.logo_url)) {
      site.logo_url = trim(tenant.logo_url) || site.logo_url || null;
    }
    if (!trim(site.primary_color)) {
      site.primary_color = trim(tenant.primary_color) || site.primary_color || null;
    }
  }
}

/**
 * Order CMS sites with workspace primary + registry rows ahead of tenant-wide fallbacks.
 * @param {Array<{ slug: string, name?: string, source?: string }>} sites
 * @param {{ primarySlug?: string|null, workspaceSlug?: string|null }} opts
 */
export async function sortSitesForWorkspace(env, sites, opts = {}) {
  const primary = trim(opts.primarySlug);
  const wsSlug = trim(opts.workspaceSlug);
  const workspaceId = trim(opts.workspaceId);
  if (env && workspaceId && (await isOperatorCmsHubWorkspace(env, workspaceId))) {
    return sortCmsHubSites(sites, { primarySlug: primary });
  }
  const score = (site) => {
    const slug = trim(site?.slug);
    if (!slug) return 99;
    if (primary && slug === primary) return 0;
    if (wsSlug && slug === wsSlug) return 1;
    if (site.source === 'agentsam_project_context') return 2;
    if (site.source === 'workspace_slug') return 3;
    if (site.source === 'cms_tenants') return 4;
    if (site.source === 'cms_pages') return 5;
    return 6;
  };
  return [...(sites || [])].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa !== sb) return sa - sb;
    return String(a.name || a.slug).localeCompare(String(b.name || b.slug));
  });
}

/**
 * @param {any} env
 * @param {{
 *   tenantId: string,
 *   workspaceId: string,
 *   explicitSlug?: string|null,
 *   bootstrapRow?: Record<string, unknown>|null,
 *   sites?: Array<{ slug: string }>|null,
 * }} opts
 */
export async function resolveCmsProjectSlug(env, opts) {
  const tenantId = trim(opts.tenantId);
  const workspaceId = trim(opts.workspaceId);
  const sites =
    opts.sites ||
    (await listCmsSitesForScope(env, { tenantId, workspaceId }));
  const allowed = new Set(sites.map((s) => trim(s.slug)).filter(Boolean));

  const pickIfAllowed = (slug, resolvedFrom) => {
    const key = trim(slug);
    if (!key || !allowed.has(key)) return null;
    const site = sites.find((s) => s.slug === key);
    return {
      project_slug: key,
      project_name: site?.name || key,
      resolved_from: resolvedFrom,
    };
  };

  const explicit = pickIfAllowed(opts.explicitSlug, 'query.project_slug');
  if (explicit) return explicit;

  const explicitKey = trim(opts.explicitSlug);
  if (explicitKey && env?.DB && tenantId) {
    try {
      const row = await env.DB.prepare(
        `SELECT 1 AS ok FROM cms_pages
          WHERE tenant_id = ?
            AND project_slug = ?
            AND status != 'archived'
          LIMIT 1`,
      )
        .bind(tenantId, explicitKey)
        .first();
      if (row?.ok) {
        return {
          project_slug: explicitKey,
          project_name: explicitKey,
          resolved_from: 'explicit_tenant_pages',
        };
      }
    } catch (_) {}
  }

  const fromBootstrap = pickIfAllowed(
    readBootstrapCmsProjectSlug(opts.bootstrapRow),
    'agentsam_bootstrap.ui_preferences_json',
  );
  if (fromBootstrap) return fromBootstrap;

  if (sites.length === 1) {
    return {
      project_slug: sites[0].slug,
      project_name: sites[0].name || sites[0].slug,
      resolved_from: 'single_site_for_scope',
    };
  }

  return {
    project_slug: null,
    project_name: null,
    resolved_from: sites.length ? 'ambiguous_requires_site' : 'no_sites_for_scope',
  };
}

/**
 * @param {any} env
 * @param {Request} request
 * @param {{ id?: string, tenant_id?: string, person_uuid?: string }} authUser
 * @param {Record<string, unknown>} [cache]
 * @param {{ explicitProjectSlug?: string|null }} [opts]
 */
export async function resolveCmsWorkspaceContext(env, request, authUser, cache = {}, opts = {}) {
  try {
    const userId = trim(authUser?.id);
    const tenantId = trim(authUser?.tenant_id);
    if (!userId || !tenantId) {
      return { error: 'AUTH_CONTEXT_MISSING', workspace_id: null, project_slug: null, sites: [] };
    }

    const bootCtx = await resolveBootstrapWorkspaceContext(env, request, userId, cache);
    if (bootCtx.error || !bootCtx.workspace_id) {
      return {
        error: bootCtx.error || 'WORKSPACE_CONTEXT_MISSING',
        workspace_id: null,
        project_slug: null,
        sites: [],
      };
    }

    const workspaceId = trim(bootCtx.workspace_id);
    let bootstrapRow = bootCtx.bootstrap || null;
    if (!bootstrapRow) {
      bootstrapRow = await ensureUserBootstrapRow(env, {
        authUser,
        userId,
        workspaceId,
        tenantId,
      });
    }
    const bootstrapPrefs = await loadCmsProjectUiPreferences(env, { workspaceId, userId }).catch(
      () => parseJsonSafe(bootstrapRow?.ui_preferences_json, {}),
    );

    let workspaceName = trim(bootstrapRow?.workspace_name) || null;
    let workspaceSlug = trim(bootstrapRow?.workspace_slug) || null;
    if (!workspaceName || !workspaceSlug) {
      try {
        const wsRow = await env.DB.prepare(
          `SELECT name, slug FROM workspaces WHERE id = ? LIMIT 1`,
        )
          .bind(workspaceId)
          .first();
        workspaceName = workspaceName || trim(wsRow?.name) || null;
        workspaceSlug = workspaceSlug || trim(wsRow?.slug) || null;
      } catch (_) {}
    }

    let projectRow = bootstrapRow;
    if (projectRow) {
      projectRow = { ...projectRow, ui_preferences_json: JSON.stringify(bootstrapPrefs) };
    } else {
      projectRow = { ui_preferences_json: JSON.stringify(bootstrapPrefs) };
    }

    let sites = await listCmsSitesForScope(env, { tenantId, workspaceId });
    const project = await resolveCmsProjectSlug(env, {
      tenantId,
      workspaceId,
      explicitSlug: opts.explicitProjectSlug,
      bootstrapRow: projectRow,
      sites,
    });

    const projectSlug = project.project_slug;
    // Must await — without it, `sites` is a Promise and JSON becomes {}, so the hub shows zero sites.
    sites = await sortSitesForWorkspace(env, sites, {
      primarySlug: projectSlug,
      workspaceSlug,
      workspaceId,
    });
    return {
      error: null,
      user_id: userId,
      tenant_id: tenantId,
      workspace_id: workspaceId,
      workspace_name: workspaceName,
      workspace_slug: workspaceSlug,
      bootstrap_id: trim(bootstrapRow?.id) || null,
      project_slug: projectSlug,
      project_name: project.project_name,
      resolved_from: project.resolved_from,
      bootstrap_cache_key:
        projectSlug && workspaceId ? cmsBootstrapKey(workspaceId, projectSlug) : null,
      sites,
      ui_label: workspaceName || workspaceSlug || 'Workspace',
      bootstrap_prefs: {
        cms_project_slug: trim(bootstrapPrefs.cms_project_slug) || null,
      },
    };
  } catch (e) {
    console.warn('[cms] resolveCmsWorkspaceContext', e?.message || e);
    return {
      error: String(e?.message || e || 'CMS_CONTEXT_FAILED').slice(0, 400),
      workspace_id: null,
      project_slug: null,
      sites: [],
    };
  }
}

/**
 * Persist user's CMS site pick on their agentsam_bootstrap row (per user + workspace).
 * @param {any} env
 * @param {{
 *   bootstrapId: string,
 *   userId: string,
 *   workspaceId: string,
 *   projectSlug: string,
 * }} opts
 */
export async function persistBootstrapCmsProjectSlug(env, opts) {
  const userId = trim(opts.userId);
  const workspaceId = trim(opts.workspaceId);
  const projectSlug = trim(opts.projectSlug);
  if (!env?.DB || !userId || !workspaceId || !projectSlug) {
    return { ok: false, error: 'missing_fields' };
  }

  const bootstrapId = trim(opts.bootstrapId);
  if (bootstrapId) {
    const row = await env.DB.prepare(
      `SELECT id, user_id, workspace_id FROM agentsam_bootstrap
       WHERE id = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
    )
      .bind(bootstrapId)
      .first()
      .catch(() => null);
    if (!row || trim(row.user_id) !== userId || trim(row.workspace_id) !== workspaceId) {
      return { ok: false, error: 'bootstrap_scope_mismatch' };
    }
  }

  const prefs = await loadCmsProjectUiPreferences(env, { workspaceId, userId });
  prefs.cms_project_slug = projectSlug;
  await saveCmsProjectUiPreferences(env, { workspaceId, userId, preferences: prefs });
  return { ok: true, cms_project_slug: projectSlug };
}

/**
 * Resolve project slug for bootstrap API — throws-style result object.
 * @param {any} env
 * @param {Request} request
 * @param {{ id?: string, tenant_id?: string }} authUser
 * @param {string} workspaceId
 * @param {string|null} explicitSlug
 * @param {Record<string, unknown>} [cache]
 */
export async function resolveCmsBootstrapProjectSlug(
  env,
  request,
  authUser,
  workspaceId,
  explicitSlug,
  cache = {},
) {
  const ctx = await resolveCmsWorkspaceContext(env, request, authUser, cache, {
    explicitProjectSlug: explicitSlug,
  });
  if (ctx.error) return { error: ctx.error, context: ctx };
  if (!ctx.project_slug) {
    return {
      error: 'CMS_PROJECT_UNRESOLVED',
      context: ctx,
      message:
        ctx.sites?.length > 1
          ? 'Multiple CMS sites available — pass project_slug or pick a site.'
          : 'No CMS site configured for this workspace.',
    };
  }
  return { project_slug: ctx.project_slug, context: ctx };
}

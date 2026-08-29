/**
 * Operator CMS hub — featured client builds from D1 (agentsam_project_context + cms_tenants).
 * No hardcoded client slug maps — registry rows drive launcher, routing, and sort order.
 */
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

/**
 * Workspace hosts the operator CMS hub launcher grid (hub_launcher rows in D1).
 * @param {any} env
 * @param {string|null|undefined} workspaceId
 */
export async function isOperatorCmsHubWorkspace(env, workspaceId) {
  const ws = trim(workspaceId);
  if (!env?.DB || !ws) return false;
  try {
    const row = await env.DB.prepare(
      `SELECT 1 AS ok
         FROM agentsam_project_context
        WHERE workspace_id = ?
          AND project_type = 'cms_site'
          AND COALESCE(status, 'active') = 'active'
          AND json_extract(notes, '$.hub_launcher') = 1
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
 * Hub launcher sites for operator CMS setup — from agentsam_project_context + cms_tenants.
 * @param {any} env
 * @param {string|null|undefined} operatorWorkspaceId
 */
export async function loadOperatorHubLauncherRows(env, operatorWorkspaceId) {
  const ws = trim(operatorWorkspaceId);
  if (!env?.DB || !ws) return [];

  let ctxRows = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT project_key, project_name, priority, notes
         FROM agentsam_project_context
        WHERE workspace_id = ?
          AND project_type = 'cms_site'
          AND COALESCE(status, 'active') = 'active'
          AND json_extract(notes, '$.hub_launcher') = 1
        ORDER BY COALESCE(priority, 0) DESC, project_name ASC, project_key ASC`,
    )
      .bind(ws)
      .all();
    ctxRows = results || [];
  } catch (_) {
    return [];
  }

  const slugs = ctxRows.map((r) => trim(r.project_key)).filter(Boolean);
  const tenantBySlug = new Map();
  if (slugs.length) {
    try {
      const placeholders = slugs.map(() => '?').join(',');
      const { results: tenants } = await env.DB.prepare(
        `SELECT slug, name, domain, logo_url, primary_color
           FROM cms_tenants
          WHERE slug IN (${placeholders}) AND COALESCE(is_active, 1) = 1`,
      )
        .bind(...slugs)
        .all();
      for (const t of tenants || []) {
        tenantBySlug.set(trim(t.slug), t);
      }
    } catch (_) {}
  }

  return ctxRows.map((row) => {
    const slug = trim(row.project_key);
    const notes = parseJsonSafe(row.notes, {});
    const tenant = tenantBySlug.get(slug);
    const priority = Number(row.priority) || 0;
    return {
      slug,
      name: trim(tenant?.name) || trim(row.project_name) || slug,
      domain: trim(tenant?.domain) || null,
      logo_url: trim(tenant?.logo_url) || null,
      primary_color: trim(tenant?.primary_color) || null,
      target_workspace_id: trim(notes.target_workspace_id) || null,
      cms_hosting: trim(notes.cms_hosting) || 'client_worker',
      hub_priority: priority,
      is_featured: true,
      source: 'cms_hub',
    };
  });
}

/**
 * Resolve client/runtime workspace for a CMS site slug (D1 only).
 * @param {any} env
 * @param {string|null|undefined} scopeWorkspaceId
 * @param {string|null|undefined} projectSlug
 */
export async function resolveTargetWorkspaceIdForCmsSlug(env, scopeWorkspaceId, projectSlug) {
  const slug = trim(projectSlug);
  const scopeWs = trim(scopeWorkspaceId);
  if (!env?.DB || !slug) return null;

  if (scopeWs) {
    try {
      const hub = await env.DB.prepare(
        `SELECT notes FROM agentsam_project_context
          WHERE workspace_id = ? AND project_key = ? AND project_type = 'cms_site'
            AND COALESCE(status, 'active') = 'active'
          LIMIT 1`,
      )
        .bind(scopeWs, slug)
        .first();
      const notes = parseJsonSafe(hub?.notes, {});
      const target = trim(notes.target_workspace_id);
      if (target) return target;
    } catch (_) {}
  }

  try {
    const row = await env.DB.prepare(
      `SELECT id FROM agentsam_workspace
        WHERE status = 'active'
          AND (workspace_slug = ? OR id = ? OR project_id = ?)
        ORDER BY updated_at DESC
        LIMIT 1`,
    )
      .bind(slug, slug.startsWith('ws_') ? slug : `ws_${slug}`, slug)
      .first();
    if (row?.id) return String(row.id);
  } catch (_) {}

  return null;
}

/**
 * Resolve which workspace should run CMS for a site slug (client workers vs platform).
 * @param {any} env
 * @param {string} activeWorkspaceId
 * @param {string|null|undefined} projectSlug
 */
export async function resolveRuntimeWorkspaceForCmsSlug(env, activeWorkspaceId, projectSlug) {
  const active = trim(activeWorkspaceId);
  const slug = trim(projectSlug);
  if (!slug) return active;

  const target = await resolveTargetWorkspaceIdForCmsSlug(env, active, slug);
  if (target && target !== active) {
    if (env?.DB) {
      try {
        const row = await env.DB.prepare(`SELECT id FROM agentsam_workspace WHERE id = ? LIMIT 1`)
          .bind(target)
          .first();
        if (row?.id) return target;
      } catch (_) {}
    } else {
      return target;
    }
  }

  return active;
}

/**
 * True when operator hub picks a site slug that routes through a client runtime workspace.
 * @param {any} env
 * @param {string} operatorWorkspaceId
 * @param {string|null|undefined} projectSlug
 */
export async function isOperatorHubSitePick(env, operatorWorkspaceId, projectSlug) {
  const ws = trim(operatorWorkspaceId);
  const slug = trim(projectSlug);
  if (!env?.DB || !ws || !slug) return false;
  if (!(await isOperatorCmsHubWorkspace(env, ws))) return false;
  try {
    const row = await env.DB.prepare(
      `SELECT notes FROM agentsam_project_context
        WHERE workspace_id = ? AND project_key = ? AND project_type = 'cms_site'
          AND COALESCE(status, 'active') = 'active'
          AND json_extract(notes, '$.hub_launcher') = 1
        LIMIT 1`,
    )
      .bind(ws, slug)
      .first();
    return !!row;
  } catch (_) {
    return false;
  }
}

/**
 * Merge featured hub sites into operator workspace site list (D1 registry).
 * @param {any} env
 * @param {string} workspaceId
 * @param {Map<string, object>} bySlug
 */
export async function mergeOperatorHubSites(env, workspaceId, bySlug) {
  const ws = trim(workspaceId);
  if (!env?.DB || !ws || !(await isOperatorCmsHubWorkspace(env, ws))) return;

  const hubRows = await loadOperatorHubLauncherRows(env, ws);
  for (const hub of hubRows) {
    const slug = trim(hub.slug);
    if (!slug) continue;
    const prev = bySlug.get(slug) || {};
    bySlug.set(slug, {
      slug,
      name: trim(hub.name) || trim(prev.name) || slug,
      domain: trim(hub.domain) || trim(prev.domain) || null,
      logo_url: trim(hub.logo_url) || trim(prev.logo_url) || null,
      primary_color: trim(hub.primary_color) || trim(prev.primary_color) || null,
      page_count: Number(prev.page_count) || 0,
      updated_at: prev.updated_at || null,
      source: prev.source || hub.source || 'cms_hub',
      target_workspace_id: trim(hub.target_workspace_id) || trim(prev.target_workspace_id) || null,
      cms_hosting: trim(hub.cms_hosting) || trim(prev.cms_hosting) || null,
      hub_priority: Number(hub.hub_priority) || Number(prev.hub_priority) || 0,
      is_featured: hub.is_featured === true || prev.is_featured === true,
    });
  }
}

/** Sort hub sites: primary slug, then hub_priority desc, featured, then name. */
export function sortCmsHubSites(sites, opts = {}) {
  const primary = trim(opts.primarySlug);
  return [...(sites || [])].sort((a, b) => {
    const pa = trim(a?.slug);
    const pb = trim(b?.slug);
    if (primary && pa === primary) return -1;
    if (primary && pb === primary) return 1;
    const priA = Number(a?.hub_priority) || 0;
    const priB = Number(b?.hub_priority) || 0;
    if (priA !== priB) return priB - priA;
    const fa = a?.is_featured ? 1 : 0;
    const fb = b?.is_featured ? 1 : 0;
    if (fa !== fb) return fb - fa;
    return String(a?.name || a?.slug).localeCompare(String(b?.name || b?.slug));
  });
}

/**
 * CMS authorization — workspace + project_slug scope.
 * Never substitute another user's tenant_id; actor identity stays authUser.tenant_id.
 */
import { listCmsSitesForScope } from './workspace-context.js';
import { userCanAccessWorkspace } from '../../../workspace-access.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/** @param {Record<string, unknown>|null|undefined} page */
export function cmsPageProjectSlug(page) {
  return trim(page?.project_slug || page?.project_id);
}

/** @param {Array<{ source?: string }>|null|undefined} sites */
export function cmsScopeUsesWorkspaceRegistry(sites) {
  return (sites || []).some((s) => s.source === 'agentsam_project_context');
}

/**
 * @param {Record<string, unknown>|null|undefined} page
 * @param {{
 *   workspaceId: string,
 *   authTenantId: string,
 *   allowedSlugs: Set<string>,
 *   sites?: Array<{ source?: string }>,
 * }} scope
 */
export function cmsPageInScope(page, scope) {
  if (!page || !scope) return false;
  const slug = cmsPageProjectSlug(page);
  if (!slug || !scope.allowedSlugs?.has?.(slug)) return false;

  if (cmsScopeUsesWorkspaceRegistry(scope.sites)) {
    const pageWs = trim(page.workspace_id);
    const ws = trim(scope.workspaceId);
    if (pageWs && ws && pageWs !== ws) return false;
    return true;
  }

  if (String(page.tenant_id) === String(scope.authTenantId)) return true;
  const pageWs = trim(page.workspace_id);
  if (pageWs && pageWs === trim(scope.workspaceId)) return true;
  return false;
}

/**
 * @param {any} env
 * @param {{ tenant_id?: string, id?: string }} authUser
 * @param {string} workspaceId
 */
export async function resolveCmsApiScope(env, authUser, workspaceId) {
  const authTenantId = trim(authUser?.tenant_id);
  const ws = trim(workspaceId);
  const empty = {
    ok: false,
    error: 'missing_context',
    authTenantId,
    workspaceId: ws,
    allowedSlugs: new Set(),
    sites: [],
    registryMode: false,
  };
  if (!env?.DB || !authTenantId || !ws) return empty;

  if (!(await userCanAccessWorkspace(env, authUser, ws))) {
    return { ...empty, error: 'workspace_forbidden' };
  }

  const sites = await listCmsSitesForScope(env, { tenantId: authTenantId, workspaceId: ws });
  const allowedSlugs = new Set(sites.map((s) => trim(s.slug)).filter(Boolean));
  const registryMode = cmsScopeUsesWorkspaceRegistry(sites);

  // Tenant-owned CMS projects remain accessible when the active workspace differs from the site's workspace.
  try {
    const { results: tenantProjectRows } = await env.DB.prepare(
      `SELECT DISTINCT project_slug AS slug
         FROM cms_pages
        WHERE tenant_id = ?
          AND status != 'archived'
          AND trim(COALESCE(project_slug, '')) != ''`,
    )
      .bind(authTenantId)
      .all();
    for (const row of tenantProjectRows || []) {
      const slug = trim(row.slug);
      if (slug) allowedSlugs.add(slug);
    }
  } catch (_) {}

  return {
    ok: allowedSlugs.size > 0,
    error: allowedSlugs.size ? null : 'no_sites',
    authTenantId,
    workspaceId: ws,
    allowedSlugs,
    sites,
    registryMode,
  };
}

/** @param {any} env @param {string} pageId */
export async function fetchCmsPageById(env, pageId) {
  const id = trim(pageId);
  if (!env?.DB || !id) return null;
  return env.DB.prepare(`SELECT * FROM cms_pages WHERE id = ? LIMIT 1`)
    .bind(id)
    .first()
    .catch(() => null);
}

/**
 * @param {any} env
 * @param {string} pageId
 * @param {ReturnType<typeof resolveCmsApiScope> extends Promise<infer T> ? T : never} scope
 * @param {string|null|undefined} [projectSlug]
 */
export async function fetchCmsPageInScope(env, pageId, scope, projectSlug = null) {
  const page = await fetchCmsPageById(env, pageId);
  if (!page) return null;
  const expected = trim(projectSlug);
  if (expected && cmsPageProjectSlug(page) !== expected) return null;
  if (!cmsPageInScope(page, scope)) return null;
  return page;
}

/**
 * @param {ReturnType<typeof resolveCmsApiScope> extends Promise<infer T> ? T : never} scope
 * @param {string|null|undefined} [projectSlug]
 */
export function buildCmsPagesListQuery(scope, projectSlug = null) {
  const slugs = projectSlug ? [trim(projectSlug)] : [...scope.allowedSlugs];
  if (!slugs.length) return null;
  const ph = slugs.map(() => '?').join(',');
  const cols = `id, project_id, project_slug, slug, title, status, route_path, updated_at, created_at`;

  if (scope.registryMode) {
    return {
      sql: `SELECT ${cols}
              FROM cms_pages
             WHERE workspace_id = ?
               AND project_slug IN (${ph})
               AND status != 'archived'
             ORDER BY created_at DESC`,
      binds: [scope.workspaceId, ...slugs],
    };
  }

  return {
    sql: `SELECT ${cols}
            FROM cms_pages
           WHERE tenant_id = ?
             AND project_slug IN (${ph})
             AND status != 'archived'
           ORDER BY created_at DESC`,
    binds: [scope.authTenantId, ...slugs],
  };
}

/**
 * @param {any} env
 * @param {string} sectionId
 * @param {ReturnType<typeof resolveCmsApiScope> extends Promise<infer T> ? T : never} scope
 */
export async function fetchCmsSectionInScope(env, sectionId, scope) {
  const sid = trim(sectionId);
  if (!env?.DB || !sid) return null;
  const row = await env.DB.prepare(
    `SELECT s.id, s.page_id FROM cms_page_sections s WHERE s.id = ? LIMIT 1`,
  )
    .bind(sid)
    .first()
    .catch(() => null);
  if (!row?.page_id) return null;
  const page = await fetchCmsPageInScope(env, row.page_id, scope);
  if (!page) return null;
  return { section: row, page };
}

/**
 * @param {any} env
 * @param {string} componentId
 * @param {ReturnType<typeof resolveCmsApiScope> extends Promise<infer T> ? T : never} scope
 */
export async function fetchCmsComponentInScope(env, componentId, scope) {
  const cid = trim(componentId);
  if (!env?.DB || !cid) return null;
  const row = await env.DB.prepare(
    `SELECT c.id, c.section_id, s.page_id
       FROM cms_section_components c
       JOIN cms_page_sections s ON s.id = c.section_id
      WHERE c.id = ? LIMIT 1`,
  )
    .bind(cid)
    .first()
    .catch(() => null);
  if (!row?.page_id) return null;
  const page = await fetchCmsPageInScope(env, row.page_id, scope);
  if (!page) return null;
  return { component: row, page };
}

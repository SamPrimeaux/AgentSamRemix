import { resolveCmsWorkspaceContext } from './workspace-context.js';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

/**
 * Resolve the selected CMS site as a domain identity, independent of hosting/runtime details.
 *
 * This composes workspace resolution with the authoritative site catalog. It deliberately does
 * not decide which Worker, D1 database, R2 bucket, or KV namespace serves the site; those are
 * deployment-adapter concerns.
 *
 * @param {any} env
 * @param {Request} request
 * @param {{ id?: string, tenant_id?: string, person_uuid?: string }} authUser
 * @param {Record<string, unknown>} [cache]
 * @param {{ explicitSiteSlug?: string|null }} [opts]
 */
export async function resolveCmsSiteContext(env, request, authUser, cache = {}, opts = {}) {
  const workspace = await resolveCmsWorkspaceContext(env, request, authUser, cache, {
    explicitProjectSlug: opts.explicitSiteSlug,
  });

  if (workspace?.error) {
    return {
      error: workspace.error,
      workspace,
      site: null,
      site_id: null,
      site_slug: null,
    };
  }

  const siteSlug = trim(workspace?.project_slug);
  if (!siteSlug) {
    return {
      error: 'CMS_SITE_UNRESOLVED',
      workspace,
      site: null,
      site_id: null,
      site_slug: null,
    };
  }

  const site = (workspace.sites || []).find((entry) => trim(entry?.slug) === siteSlug) || null;
  if (!site) {
    return {
      error: 'CMS_SITE_NOT_IN_SCOPE',
      workspace,
      site: null,
      site_id: null,
      site_slug: siteSlug,
    };
  }

  return {
    error: null,
    workspace,
    site,
    site_id: trim(site.id) || null,
    site_slug: siteSlug,
    site_name: trim(site.name) || siteSlug,
    public_domain: trim(site.domain) || null,
    tenant_id: trim(workspace.tenant_id) || null,
    workspace_id: trim(workspace.workspace_id) || null,
    resolved_from: workspace.resolved_from || null,
  };
}

/**
 * Pure helper for consumers that already have a resolved workspace context.
 * @param {Record<string, any>|null|undefined} workspaceContext
 * @param {string|null|undefined} [siteSlug]
 */
export function selectCmsSiteFromWorkspaceContext(workspaceContext, siteSlug = null) {
  const slug = trim(siteSlug) || trim(workspaceContext?.project_slug);
  if (!slug) return null;
  return (workspaceContext?.sites || []).find((entry) => trim(entry?.slug) === slug) || null;
}

/**
 * CMS workspace context HTTP adapter.
 *
 * Transport ownership lives here. The CMS context behavior is still being peeled
 * from src/core/agentsam/cms; import only those domain functions, never the legacy
 * src/api/cms.js facade.
 */
import {
  listCmsSitesForScope,
  normalizeCmsSitesResponse,
  persistBootstrapCmsProjectSlug,
  resolveCmsWorkspaceContext,
} from '../../../src/core/agentsam/cms/context/workspace-context.js';
import { isOperatorCmsHubWorkspace } from '../../../src/core/agentsam/cms/context/hub-sites.js';
import { resolveCmsSiteConfig } from '../../../src/core/cms-site-config.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function authUserFromIdentity(identity) {
  const userId = trim(identity?.userId);
  const tenantId = trim(identity?.tenantId);
  if (!userId || !tenantId) return null;
  return {
    id: userId,
    tenant_id: tenantId,
    person_uuid: trim(identity?.personUuid) || null,
    workspace_id: trim(identity?.workspaceId) || null,
    email: identity?.email ?? null,
  };
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {{userId:string,tenantId:string|null,workspaceId:string,personUuid?:string|null,email?:string|null}} identity
 */
export async function handleCmsWorkspaceContextRequest(request, env, identity) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/cms/workspace-context') return null;
  if (request.method !== 'GET' && request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const authUser = authUserFromIdentity(identity);
  if (!authUser) return json({ error: 'identity_scope_required' }, 409);
  if (!env?.DB) return json({ error: 'database_unavailable' }, 503);

  // Prevent the CMS resolver from authenticating the same request again.
  const requestCache = { __authUser: authUser };

  if (request.method === 'GET') {
    try {
      const explicit =
        url.searchParams.get('project_slug') ||
        url.searchParams.get('site') ||
        null;
      const wsCtx = await resolveCmsWorkspaceContext(env, request, authUser, requestCache, {
        explicitProjectSlug: explicit,
      });
      if (wsCtx.error) {
        return json(
          { error: wsCtx.error, sites: normalizeCmsSitesResponse(wsCtx.sites) },
          400,
        );
      }
      const siteConfig = await resolveCmsSiteConfig(
        env,
        wsCtx.workspace_id,
        wsCtx.project_slug,
      );
      return json({
        ...wsCtx,
        ...siteConfig,
        is_operator_hub: await isOperatorCmsHubWorkspace(env, wsCtx.workspace_id),
        sites: normalizeCmsSitesResponse(wsCtx.sites),
      });
    } catch (error) {
      console.warn('[cms] workspace-context GET', error?.message || error);
      let sites = [];
      try {
        sites = await listCmsSitesForScope(env, {
          tenantId: authUser.tenant_id,
          workspaceId: authUser.workspace_id,
        });
      } catch {}
      return json({ error: error?.message || 'cms_workspace_context_failed', sites }, 500);
    }
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  const projectSlug = trim(body?.project_slug || body?.site);
  if (!projectSlug) return json({ error: 'project_slug required' }, 400);

  try {
    const wsCtx = await resolveCmsWorkspaceContext(env, request, authUser, requestCache);
    if (wsCtx.error) return json({ error: wsCtx.error }, 400);
    if (!(wsCtx.sites || []).some((site) => trim(site?.slug) === projectSlug)) {
      return json({ error: 'CMS_SITE_NOT_ALLOWED', project_slug: projectSlug }, 403);
    }
    if (!wsCtx.bootstrap_id) return json({ error: 'BOOTSTRAP_ROW_MISSING' }, 409);

    const saved = await persistBootstrapCmsProjectSlug(env, {
      bootstrapId: wsCtx.bootstrap_id,
      userId: authUser.id,
      workspaceId: wsCtx.workspace_id,
      projectSlug,
    });
    if (!saved.ok) return json({ error: saved.error || 'persist_failed' }, 409);

    const next = await resolveCmsWorkspaceContext(
      env,
      request,
      authUser,
      { __authUser: authUser },
      { explicitProjectSlug: projectSlug },
    );
    const siteConfig = await resolveCmsSiteConfig(env, next.workspace_id, next.project_slug);
    return json({
      ok: true,
      ...next,
      ...siteConfig,
      is_operator_hub: await isOperatorCmsHubWorkspace(env, next.workspace_id),
      sites: normalizeCmsSitesResponse(next.sites),
    });
  } catch (error) {
    return json({ error: error?.message || 'cms_workspace_context_failed' }, 500);
  }
}

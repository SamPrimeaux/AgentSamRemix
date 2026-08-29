/**
 * Shared CMS stores + scope for agent tools (same adapters as HTTP CMS facade).
 * One capability → one tool; do not invent mega-ops here.
 */
import { resolveCmsApiScope } from '../context/access.js';
import { createD1CmsPageStore } from '../adapters/cloudflare/d1-page-store.js';
import { createD1CmsSectionStore } from '../adapters/cloudflare/d1-section-store.js';
import { createD1CmsBlockStore } from '../adapters/cloudflare/d1-block-store.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} runContext
 */
export async function resolveCmsAgentRuntime(env, runContext = {}) {
  const tenantId = trim(runContext.tenantId ?? runContext.tenant_id);
  const userId = trim(runContext.userId ?? runContext.user_id);
  const workspaceId = trim(runContext.workspaceId ?? runContext.workspace_id);
  if (!env?.DB) return { ok: false, error: 'db_missing' };
  if (!tenantId) return { ok: false, error: 'tenant_required' };
  if (!workspaceId) return { ok: false, error: 'workspace_required' };
  if (!userId) return { ok: false, error: 'user_required' };

  const authUser = {
    id: userId,
    tenant_id: tenantId,
    workspace_id: workspaceId,
  };
  const cmsScope = await resolveCmsApiScope(env, authUser, workspaceId);
  if (!cmsScope?.ok) {
    return {
      ok: false,
      error: cmsScope?.error || 'cms_scope_failed',
      cmsScope,
    };
  }

  return {
    ok: true,
    tenantId,
    userId,
    workspaceId,
    actor: {
      tenantId,
      userId,
      workspaceId,
      personUuid: trim(runContext.personUuid ?? runContext.person_uuid) || userId,
    },
    cmsScope,
    pageStore: createD1CmsPageStore(env.DB),
    sectionStore: createD1CmsSectionStore(env),
    blockStore: createD1CmsBlockStore(env.DB),
  };
}

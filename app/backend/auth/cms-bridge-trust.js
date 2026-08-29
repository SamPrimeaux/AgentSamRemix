/**
 * CMS bridge trust — server-to-server headers using AGENTSAM_BRIDGE_KEY (no browser exposure).
 * Outbound from IAM hub → client Worker /api/cms/* (see cms-federated-hub-architecture.md).
 *
 * Takes the full IdentityContext (identity-context.js), not a
 * flattened {id, tenant_id} bag. tenant_id was never part of authUser
 * under the identity substrate SSOT (see docs/platform/
 * identity-substrate-2026-08.md §6) — it lives on IdentityContext.tenant,
 * a request-scoped field, not a fact about the person. This function
 * previously accepted an ad hoc shape that quietly mixed the two.
 */
function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {any} env
 */
export function assertBridgeKeyConfigured(env) {
  const key = trim(env?.AGENTSAM_BRIDGE_KEY);
  if (!key) {
    return { ok: false, error: 'AGENTSAM_BRIDGE_KEY not configured' };
  }
  return { ok: true };
}

/**
 * @param {any} env
 * @param {import('../identity/contracts/identity-context.js').IdentityContext} identity
 * @param {Record<string, unknown>} siteConfig
 */
export function buildCmsBridgeHeaders(env, identity, siteConfig) {
  const gate = assertBridgeKeyConfigured(env);
  if (!gate.ok) throw new Error(gate.error || 'bridge_key_missing');

  const userId = trim(identity?.user?.id);
  const tenantId = trim(identity?.tenant?.id);
  const workspaceId = trim(siteConfig?.workspace_id);
  const projectSlug = trim(siteConfig?.project_slug);

  if (!userId || !tenantId || !workspaceId) {
    throw new Error('bridge_identity_headers_incomplete');
  }

  return {
    Authorization: `Bearer ${String(env.AGENTSAM_BRIDGE_KEY).trim()}`,
    'X-User-Id': userId,
    'X-Tenant-Id': tenantId,
    'X-Workspace-Id': workspaceId,
    'X-Project-Slug': projectSlug || trim(siteConfig?.worker_name) || '',
    Accept: 'application/json',
  };
}

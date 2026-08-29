/**
 * CMS bridge trust — server-to-server headers using AGENTSAM_BRIDGE_KEY (no browser exposure).
 * Outbound from IAM hub → client Worker /api/cms/* (see cms-federated-hub-architecture.md).
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
 * @param {{ id?: string, tenant_id?: string }} authUser
 * @param {Record<string, unknown>} siteConfig
 */
export function buildCmsBridgeHeaders(env, authUser, siteConfig) {
  const gate = assertBridgeKeyConfigured(env);
  if (!gate.ok) throw new Error(gate.error || 'bridge_key_missing');

  const userId = trim(authUser?.id);
  const tenantId = trim(authUser?.tenant_id);
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

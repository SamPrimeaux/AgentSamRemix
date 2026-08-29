/**
 * Deterministic personal workspace key derived from a tenant id.
 */
export function workspaceSlugFromTenantId(tenantId) {
  const tail = String(tenantId || '')
    .replace('tenant_', '')
    .replace(/[^a-z0-9]/g, '_')
    .slice(0, 36);
  return `ws_${tail}`.slice(0, 40);
}

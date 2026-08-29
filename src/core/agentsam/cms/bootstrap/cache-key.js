export const CMS_BOOTSTRAP_TTL_SEC = 300;

export function cmsBootstrapKey(workspaceId, projectSlug) {
  return `cms:bootstrap:v2:${String(workspaceId || '').trim()}:${String(projectSlug || '').trim()}`;
}

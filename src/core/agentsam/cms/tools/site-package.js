/** Site-package agent tools (workflow-shaped; not on cms_edit profile). Temporary legacy host APIs listed in dependency-policy. */
import { getSitePackageInventory, enqueueSitePackageProceed } from '../../../cms-site-package-api.js';
import { listCmsProceedTargets } from '../../../resolve-cms-database.js';
import { auditSitePackageById } from '../adapters/cloudflare/package-audit.js';

/**
 * @param {Record<string, unknown>} params
 * @param {any} env
 * @param {Record<string, unknown>} runContext
 */
async function sitePackageInventory(params, env, runContext) {
  const packageId = String(
    params.package_id ?? params.import_id ?? params.id ?? '',
  ).trim();
  const tenantId = String(runContext.tenantId ?? runContext.tenant_id ?? '').trim();
  if (!env?.DB || !packageId) return { error: 'package_id required' };

  const inv = await getSitePackageInventory(env, tenantId, packageId);
  if (!inv.ok) return { error: inv.error };
  return {
    ok: true,
    package: inv.package,
    manifest: inv.manifest,
    python_audit: inv.python_audit,
    proposed_scaffold: inv.proposed_scaffold,
    gallery_candidates: inv.gallery_candidates,
    liquid_sections: inv.liquid_sections,
    proceed_targets: inv.proceed_targets,
    ready: inv.ready,
    can_proceed: inv.can_proceed,
  };
}

/**
 * @param {Record<string, unknown>} params
 * @param {any} env
 * @param {Record<string, unknown>} runContext
 */
async function sitePackageProceed(params, env, runContext) {
  const packageId = String(
    params.package_id ?? params.import_id ?? params.id ?? '',
  ).trim();
  const tenantId = String(runContext.tenantId ?? runContext.tenant_id ?? '').trim();
  const workspaceId = String(runContext.workspaceId ?? runContext.workspace_id ?? '').trim();
  const userId = String(runContext.userId ?? runContext.user_id ?? '').trim();
  if (!env?.DB || !packageId || !workspaceId) {
    return { error: 'package_id and workspace_id required' };
  }

  const inv = await getSitePackageInventory(env, tenantId, packageId);
  if (!inv.ok) return { error: inv.error };
  if (!inv.ready) {
    return {
      error: 'package_not_ready',
      status: inv.package?.status,
      hint: 'Poll agentsam_site_package_inventory until ready=true',
    };
  }

  const apply = {
    template: params.template ?? params.template_name ?? inv.manifest?.default_template ?? 'index',
    sections: params.sections ?? inv.manifest?.default_section_keys ?? null,
    db_target: params.db_target ?? 'platform',
    database_id: params.database_id ?? null,
    r2_target: params.r2_target ?? 'shared',
    r2_bucket: params.r2_bucket ?? null,
    worker_target: params.worker_target ?? 'shared',
    worker_name: params.worker_name ?? null,
    project_slug: params.project_slug ?? inv.package?.project_id,
    project_name: params.project_name ?? null,
  };

  const ctx = /** @type {ExecutionContext} */ ({ waitUntil: () => {} });
  const result = await enqueueSitePackageProceed(env, ctx, {
    importId: packageId,
    tenantId,
    workspaceId,
    userId,
    apply,
  });
  return { ok: true, ...result, apply };
}

/**
 * @param {Record<string, unknown>} params
 * @param {any} env
 * @param {Record<string, unknown>} runContext
 */
async function sitePackageProceedTargets(params, env, runContext) {
  const workspaceId = String(
    params.workspace_id ?? runContext.workspaceId ?? runContext.workspace_id ?? '',
  ).trim();
  if (!workspaceId) return { error: 'workspace_id required' };
  const targets = await listCmsProceedTargets(env, workspaceId);
  return { ok: true, workspace_id: workspaceId, ...targets };
}

/**
 * Python deep audit + proposed scaffold + gallery candidates for a site package.
 * @param {Record<string, unknown>} params
 * @param {any} env
 * @param {Record<string, unknown>} runContext
 */
async function sitePackageAudit(params, env, runContext) {
  const packageId = String(
    params.package_id ?? params.import_id ?? params.id ?? '',
  ).trim();
  const tenantId = String(runContext.tenantId ?? runContext.tenant_id ?? '').trim();
  if (!packageId) return { error: 'package_id required' };
  const out = await auditSitePackageById(env, tenantId, packageId);
  if (!out.ok) return out;
  return out;
}

export const sitePackageHandlers = {
  agentsam_site_package_inventory: sitePackageInventory,
  cms_site_package_inventory: sitePackageInventory,
  agentsam_site_package_proceed: sitePackageProceed,
  cms_site_package_proceed: sitePackageProceed,
  agentsam_site_package_proceed_targets: sitePackageProceedTargets,
  cms_site_package_proceed_targets: sitePackageProceedTargets,
  agentsam_site_package_audit: sitePackageAudit,
  cms_site_package_audit: sitePackageAudit,
};

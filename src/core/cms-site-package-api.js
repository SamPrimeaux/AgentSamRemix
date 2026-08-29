/**
 * Site Package API helpers — inventory read + proceed enqueue.
 */
import { parsePackageManifest } from './cms-theme-inventory.js';
import { listCmsProceedTargets } from './resolve-cms-database.js';

/**
 * @param {any} env
 * @param {string} tenantId
 * @param {string} packageId
 */
export async function getSitePackageInventory(env, tenantId, packageId) {
  const id = String(packageId || '').trim();
  if (!env?.DB || !id) return { ok: false, error: 'missing_id' };

  const row = await env.DB.prepare(
    `SELECT id, tenant_id, workspace_id, project_id, import_name, import_key, status,
            sections_found, sections_mapped, pages_created, templates_found,
            r2_bucket, r2_key, result_json, metadata_json, error_log, created_at, completed_at
     FROM cms_liquid_imports WHERE id = ? LIMIT 1`,
  )
    .bind(id)
    .first()
    .catch(() => null);

  if (!row) return { ok: false, error: 'package_not_found', status: 404 };
  if (tenantId && String(row.tenant_id) !== String(tenantId)) {
    return { ok: false, error: 'package_forbidden', status: 403 };
  }

  const manifest = parsePackageManifest(row.result_json);
  const { results: liquidSections } = await env.DB.prepare(
    `SELECT id, section_key, section_type, file_name, parse_status, mapped_section_id
     FROM cms_liquid_sections WHERE import_id = ? ORDER BY section_key ASC`,
  )
    .bind(id)
    .all()
    .catch(() => ({ results: [] }));

  const proceedTargets = row.workspace_id
    ? await listCmsProceedTargets(env, String(row.workspace_id))
    : null;

  return {
    ok: true,
    package: {
      id: row.id,
      import_name: row.import_name,
      project_id: row.project_id,
      workspace_id: row.workspace_id,
      status: row.status,
      sections_found: row.sections_found,
      sections_mapped: row.sections_mapped,
      pages_created: row.pages_created,
      templates_found: row.templates_found,
      staging_prefix: manifest?.staging_prefix || null,
      archive_r2_key: manifest?.archive_r2_key || row.r2_key,
      audit_r2_key: manifest?.audit_r2_key || null,
      has_python_audit: Boolean(manifest?.python_audit),
      gallery_candidates_count: Array.isArray(manifest?.gallery_candidates)
        ? manifest.gallery_candidates.length
        : 0,
      created_at: row.created_at,
      completed_at: row.completed_at,
      error_log: row.error_log,
    },
    manifest,
    python_audit: manifest?.python_audit || null,
    proposed_scaffold: manifest?.proposed_scaffold || null,
    gallery_candidates: manifest?.gallery_candidates || [],
    liquid_sections: liquidSections || [],
    proceed_targets: proceedTargets,
    ready: row.status === 'inventory_ready',
    can_proceed: row.status === 'inventory_ready',
  };
}

/**
 * @param {any} env
 * @param {ExecutionContext} ctx
 * @param {{
 *   importId: string,
 *   tenantId: string,
 *   workspaceId: string,
 *   userId: string,
 *   apply: Record<string, unknown>,
 * }} opts
 */
export async function enqueueSitePackageProceed(env, ctx, opts) {
  const importId = String(opts.importId || '').trim();
  if (!env.MY_QUEUE) {
    const { handleSitePackageApplyJob } = await import('./cms-site-package-proceed.js');
    return handleSitePackageApplyJob(env, {
      import_id: importId,
      tenant_id: opts.tenantId,
      workspace_id: opts.workspaceId,
      apply: { ...opts.apply, user_id: opts.userId },
    });
  }

  await env.MY_QUEUE.send({
    type: 'cms_liquid_import',
    phase: 'apply',
    import_id: importId,
    tenant_id: opts.tenantId,
    workspace_id: opts.workspaceId,
    apply: { ...opts.apply, user_id: opts.userId },
  });

  return { ok: true, queued: true, import_id: importId, status: 'applying' };
}

/**
 * Site Package Proceed — materialize user selection into target D1 + R2 (Phase B).
 */
import { extractThemeArchive, findShopifyLiquidSections } from './cms-theme-archive.js';
import { scaffoldPublishedHomepageFromThemeImport } from './cms-theme-scaffold.js';
import { parsePackageManifest } from './cms-theme-inventory.js';
import { resolveCmsDatabase } from './resolve-cms-database.js';
import { CMS_DEFAULT_R2_BUCKET, getCmsR2Binding } from './cms-r2-binding.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} body
 */
export async function handleSitePackageApplyJob(env, body) {
  const importId = trim(body.import_id);
  const workspaceId = trim(body.workspace_id);
  const tenantId = trim(body.tenant_id);
  const apply = body.apply && typeof body.apply === 'object' ? body.apply : body;

  if (!env?.DB || !importId) {
    return { ok: false, error: 'missing_db_or_import_id' };
  }

  const importRow = await env.DB.prepare(`SELECT * FROM cms_liquid_imports WHERE id = ? LIMIT 1`)
    .bind(importId)
    .first()
    .catch(() => null);

  if (!importRow) return { ok: false, error: 'import_not_found' };

  const status = trim(importRow.status);
  if (status !== 'inventory_ready') {
    return {
      ok: false,
      error: 'import_not_ready',
      status,
      hint: 'Package must be inventory_ready before proceed',
    };
  }

  const projectSlug = trim(apply.project_slug || importRow.project_id);
  if (!projectSlug) return { ok: false, error: 'project_slug_required' };

  const userId = trim(apply.user_id || importRow.created_by || 'system');
  const authUser = apply.auth_user || { id: userId, tenant_id: tenantId || importRow.tenant_id };

  const cmsTarget = await resolveCmsDatabase(env, authUser, workspaceId || importRow.workspace_id, {
    db_target: apply.db_target,
    database_id: apply.database_id,
    r2_target: apply.r2_target,
    r2_bucket: apply.r2_bucket,
    worker_target: apply.worker_target,
    worker_name: apply.worker_name,
  });

  if (!cmsTarget.ok) {
    await markApplyFailed(env, importId, cmsTarget.error || 'resolve_cms_database_failed');
    return { ok: false, ...cmsTarget };
  }

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE cms_liquid_imports SET status = 'applying', updated_at = ? WHERE id = ?`,
  )
    .bind(now, importId)
    .run()
    .catch(() => {});

  try {
    const r2Key = trim(importRow.r2_key);
    const r2Bucket = trim(importRow.r2_bucket || CMS_DEFAULT_R2_BUCKET);
    const r2 = getCmsR2Binding(env, r2Bucket);
    if (!r2 || !r2Key) throw new Error('archive_unavailable');

    const obj = await r2.get(r2Key);
    if (!obj) throw new Error(`archive_not_found:${r2Key}`);
    const buf = await obj.arrayBuffer();
    const entries = await extractThemeArchive(buf, trim(importRow.import_name || 'theme.zip'));
    const liquidSections = findShopifyLiquidSections(entries);

    const ctxRow = await env.DB.prepare(
      `SELECT project_name FROM agentsam_project_context
       WHERE workspace_id = ? AND project_key = ? LIMIT 1`,
    )
      .bind(workspaceId || importRow.workspace_id, projectSlug)
      .first()
      .catch(() => null);

    const templateName = trim(apply.template || apply.template_name || 'index') || 'index';
    const selectedSections = Array.isArray(apply.sections) ? apply.sections.map((s) => String(s)) : null;

    const scaffoldResult = await scaffoldPublishedHomepageFromThemeImport(
      { ...env, DB: cmsTarget.db },
      {
        tenantId: tenantId || importRow.tenant_id,
        workspaceId: workspaceId || importRow.workspace_id,
        projectSlug,
        projectName: trim(apply.project_name) || ctxRow?.project_name || projectSlug,
        userId,
        personUuid: userId,
        importId,
        entries,
        liquidSections,
        templateName,
        selectedSections,
        r2Bucket: cmsTarget.r2_bucket,
        updatePlatformImportRow: false,
      },
    );

    if (!scaffoldResult.ok) {
      throw new Error(scaffoldResult.error || 'scaffold_failed');
    }

    const manifest = parsePackageManifest(importRow.result_json) || {};
    const proceedMeta = {
      applied_at: new Date().toISOString(),
      db_target: cmsTarget.target,
      database_id: cmsTarget.database_id,
      r2_bucket: cmsTarget.r2_bucket,
      worker_name: cmsTarget.worker_name,
      template: templateName,
      sections: selectedSections || manifest.default_section_keys || [],
      scaffold: scaffoldResult,
    };

    let priorMeta = {};
    try {
      priorMeta =
        typeof importRow.metadata_json === 'string'
          ? JSON.parse(importRow.metadata_json || '{}')
          : importRow.metadata_json || {};
    } catch {
      priorMeta = {};
    }

    await env.DB.prepare(
      `UPDATE cms_liquid_imports
       SET status = 'completed',
           sections_mapped = ?,
           pages_created = 1,
           result_json = ?,
           metadata_json = ?,
           completed_at = ?,
           updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        scaffoldResult.sections_mapped || 0,
        JSON.stringify({ ...manifest, proceed: proceedMeta, scaffold: scaffoldResult }),
        JSON.stringify({ ...priorMeta, proceed: proceedMeta }),
        now,
        now,
        importId,
      )
      .run();

    return {
      ok: true,
      import_id: importId,
      project_slug: projectSlug,
      cms_target: cmsTarget.target,
      database_id: cmsTarget.database_id,
      r2_bucket: cmsTarget.r2_bucket,
      worker_name: cmsTarget.worker_name,
      scaffold: scaffoldResult,
    };
  } catch (e) {
    const err = String(e?.message || e);
    await markApplyFailed(env, importId, err);
    return { ok: false, error: err };
  }
}

/** @param {any} env @param {string} importId @param {string} err */
async function markApplyFailed(env, importId, err) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE cms_liquid_imports SET status = 'failed', error_log = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(err, now, importId)
    .run()
    .catch(() => {});
}

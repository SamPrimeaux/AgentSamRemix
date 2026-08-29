/**
 * Python CMS pipeline — theme audit, scaffold proposal, Liquid→HTML conversion.
 */
import {
  fetchCmsPipelineJson,
  hasCmsPipelineBinding,
} from './pipeline-service.js';
import { parsePackageManifest } from '../../packages/inventory.js';
import { CMS_DEFAULT_R2_BUCKET, getCmsR2Binding } from './storage.js';

const MAX_SECTIONS_FOR_AUDIT = 120;
const MAX_LIQUID_CHARS = 48000;

/**
 * @param {any} env
 * @param {string} r2Bucket
 * @param {string} r2Key
 */
async function readR2Text(env, r2Bucket, r2Key) {
  const r2 = getCmsR2Binding(env, r2Bucket);
  if (!r2 || !r2Key) return '';
  const obj = await r2.get(r2Key).catch(() => null);
  if (!obj) return '';
  return obj.text().catch(() => '');
}

/**
 * @param {any} env
 * @param {{
 *   manifest: Record<string, unknown>,
 *   liquidSections: Array<{ section_key: string, path?: string, liquid_source?: string, r2_key?: string }>,
 *   r2Bucket?: string,
 *   projectSlug?: string,
 *   workspaceId?: string,
 * }} opts
 */
export async function runThemePackagePythonAudit(env, opts) {
  if (!hasCmsPipelineBinding(env)) {
    return {
      ok: false,
      skipped: true,
      error: 'CMS_PIPELINE binding not configured',
    };
  }

  const manifest = opts.manifest || {};
  const r2Bucket = String(opts.r2Bucket || CMS_DEFAULT_R2_BUCKET);
  const sectionsPayload = [];

  for (const sec of (opts.liquidSections || []).slice(0, MAX_SECTIONS_FOR_AUDIT)) {
    const sectionKey = String(sec.section_key || '').trim();
    if (!sectionKey) continue;
    let liquid = String(sec.liquid_source || '');
    if ((!liquid || liquid.length < 20) && sec.r2_key) {
      liquid = await readR2Text(env, r2Bucket, String(sec.r2_key));
    }
    sectionsPayload.push({
      section_key: sectionKey,
      path: sec.path || `sections/${sectionKey}.liquid`,
      liquid_source: liquid.slice(0, MAX_LIQUID_CHARS),
    });
  }

  const audit = await fetchCmsPipelineJson(env, '/pipeline/theme-audit', {
    manifest,
    sections: sectionsPayload,
    templates: manifest.templates,
    categories: manifest.categories,
  });
  if (audit.error) {
    return { ok: false, error: audit.error, status: audit.status, body: audit.body };
  }

  const scaffold = await fetchCmsPipelineJson(env, '/pipeline/theme-scaffold-plan', {
    manifest,
    audit,
    project_slug: opts.projectSlug || 'site',
    workspace_id: opts.workspaceId || '',
  });
  if (scaffold.error) {
    return {
      ok: true,
      python_audit: audit,
      proposed_scaffold: null,
      scaffold_error: scaffold.error,
    };
  }

  return {
    ok: true,
    python_audit: audit,
    proposed_scaffold: scaffold.proposed_scaffold || scaffold,
    gallery_candidates: scaffold.proposed_scaffold?.gallery_candidates || audit.gallery_candidates || [],
  };
}

/**
 * Persist audit report to R2 + merge into cms_liquid_imports.result_json.
 * @param {any} env
 * @param {{
 *   importId: string,
 *   manifest: Record<string, unknown>,
 *   auditResult: Record<string, unknown>,
 *   r2Bucket?: string,
 * }} opts
 */
export async function persistThemePackageAudit(env, opts) {
  const importId = String(opts.importId || '').trim();
  const auditResult = opts.auditResult || {};
  if (!importId || !env?.DB) return { ok: false, error: 'missing_import_or_db' };

  const r2Bucket = String(opts.r2Bucket || CMS_DEFAULT_R2_BUCKET);
  const r2 = getCmsR2Binding(env, r2Bucket);
  const reportKey = `cms/liquid-imports/${importId}/audit/report.json`;
  const mergedManifest = {
    ...(opts.manifest || {}),
    python_audit: auditResult.python_audit || null,
    proposed_scaffold: auditResult.proposed_scaffold || null,
    gallery_candidates: auditResult.gallery_candidates || auditResult.proposed_scaffold?.gallery_candidates || [],
    audit_r2_key: reportKey,
    audit_at: new Date().toISOString(),
  };

  if (r2) {
    await r2
      .put(reportKey, JSON.stringify(mergedManifest, null, 2), {
        httpMetadata: { contentType: 'application/json' },
      })
      .catch(() => {});
  }

  await env.DB.prepare(
    `UPDATE cms_liquid_imports SET result_json = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(JSON.stringify(mergedManifest), Math.floor(Date.now() / 1000), importId)
    .run()
    .catch(() => {});

  const sections = auditResult.python_audit?.sections || [];
  for (const row of sections.slice(0, MAX_SECTIONS_FOR_AUDIT)) {
    const key = String(row.section_key || '').trim();
    if (!key) continue;
    await env.DB.prepare(
      `UPDATE cms_liquid_sections SET parse_status = 'parsed', section_type = ?
       WHERE import_id = ? AND section_key = ? AND parse_status IN ('inventory', 'pending')`,
    )
      .bind(String(row.iam_section_type || 'shopify_section'), importId, key)
      .run()
      .catch(() => {});
  }

  return { ok: true, report_r2_key: reportKey, manifest: mergedManifest };
}

/**
 * On-demand audit for an existing package (API / Agent Sam).
 * @param {any} env
 * @param {string} tenantId
 * @param {string} packageId
 */
export async function auditSitePackageById(env, tenantId, packageId) {
  const id = String(packageId || '').trim();
  if (!env?.DB || !id) return { ok: false, error: 'missing_id' };

  const row = await env.DB.prepare(
    `SELECT id, tenant_id, workspace_id, project_id, status, r2_bucket, result_json
     FROM cms_liquid_imports WHERE id = ? LIMIT 1`,
  )
    .bind(id)
    .first()
    .catch(() => null);

  if (!row) return { ok: false, error: 'package_not_found', status: 404 };
  if (tenantId && String(row.tenant_id) !== String(tenantId)) {
    return { ok: false, error: 'package_forbidden', status: 403 };
  }

  const manifest = parsePackageManifest(row.result_json) || {};
  const { results: liquidRows } = await env.DB.prepare(
    `SELECT section_key, file_name, liquid_source FROM cms_liquid_sections WHERE import_id = ? ORDER BY section_key`,
  )
    .bind(id)
    .all()
    .catch(() => ({ results: [] }));

  const stagingPrefix = String(manifest.staging_prefix || `cms/liquid-imports/${id}/extracted`);
  const liquidSections = (liquidRows || []).map((r) => ({
    section_key: r.section_key,
    path: `sections/${r.file_name || r.section_key}.liquid`,
    liquid_source: r.liquid_source,
    r2_key: `${stagingPrefix}/sections/${r.file_name || `${r.section_key}.liquid`}`,
  }));

  const auditResult = await runThemePackagePythonAudit(env, {
    manifest,
    liquidSections,
    r2Bucket: row.r2_bucket,
    projectSlug: row.project_id,
    workspaceId: row.workspace_id,
  });

  if (!auditResult.ok && !auditResult.skipped) {
    return auditResult;
  }
  if (auditResult.skipped) {
    return { ok: false, skipped: true, error: auditResult.error, hint: 'Deploy iam-cms-pipeline Worker' };
  }

  const persisted = await persistThemePackageAudit(env, {
    importId: id,
    manifest,
    auditResult,
    r2Bucket: row.r2_bucket,
  });

  return {
    ok: true,
    package_id: id,
    status: row.status,
    python_audit: auditResult.python_audit,
    proposed_scaffold: auditResult.proposed_scaffold,
    gallery_candidates: auditResult.gallery_candidates,
    report_r2_key: persisted.report_r2_key,
  };
}

/**
 * Convert one or more Liquid sections to IAM HTML via Python.
 * @param {any} env
 * @param {{ section_key?: string, liquid_source?: string, section_keys?: string[], import_id?: string }} opts
 */
export async function convertLiquidSectionsToHtml(env, opts) {
  if (!hasCmsPipelineBinding(env)) {
    return { ok: false, error: 'CMS_PIPELINE binding not configured' };
  }

  let sections = [];
  if (opts.import_id && env?.DB) {
    const { results } = await env.DB.prepare(
      `SELECT section_key, liquid_source FROM cms_liquid_sections WHERE import_id = ?`,
    )
      .bind(String(opts.import_id))
      .all()
      .catch(() => ({ results: [] }));
    sections = results || [];
  } else if (opts.liquid_source) {
    sections = [{ section_key: opts.section_key || 'section', liquid_source: opts.liquid_source }];
  }

  const keys = Array.isArray(opts.section_keys) ? opts.section_keys : null;
  const out = await fetchCmsPipelineJson(env, '/pipeline/liquid-to-html-batch', {
    sections: sections.map((s) => ({
      section_key: s.section_key,
      liquid_source: String(s.liquid_source || '').slice(0, MAX_LIQUID_CHARS),
    })),
    section_keys: keys,
  });
  if (out.error) return { ok: false, ...out };
  return { ok: true, ...out };
}

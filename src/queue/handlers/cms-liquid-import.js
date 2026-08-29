/**
 * CMS liquid import queue consumer — tar.gz/zip extract → R2 staging → cms_liquid_sections.
 * BROWSER_SESSION CDP screenshots remain optional (deferred).
 */

import {
  extractThemeArchive,
  findShopifyLiquidSections,
} from '../../core/agentsam/cms/packages/archive.js';
import { buildThemePackageManifest } from '../../core/agentsam/cms/packages/inventory.js';
import { handleSitePackageApplyJob } from '../../core/cms-site-package-proceed.js';
import {
  persistThemePackageAudit,
  runThemePackagePythonAudit,
} from '../../core/agentsam/cms/adapters/cloudflare/package-audit.js';

import { CMS_DEFAULT_R2_BUCKET, getCmsR2Binding } from '../../core/agentsam/cms/adapters/cloudflare/storage.js';
import { emitInnerAnimalProEvent } from '../../core/inneranimalpro-stream.js';

/** @param {any} env @param {string} bucketName */
function getR2(env, bucketName) {
  return getCmsR2Binding(env, bucketName);
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} body
 */
export async function handleCmsLiquidImportQueueJob(env, body) {
  const phase = String(body.phase || 'inventory').trim().toLowerCase();
  if (phase === 'apply') {
    return handleSitePackageApplyJob(env, body);
  }

  const importId = String(body.import_id || '').trim();
  const conversionId = String(body.conversion_id || '').trim();
  const tenantId = String(body.tenant_id || '').trim();
  const workspaceId = String(body.workspace_id || '').trim();
  const jobId = importId || conversionId;

  if (!env?.DB || !jobId) {
    return { ok: false, error: 'missing_db_or_job_id' };
  }

  let importRow = null;
  if (importId) {
    importRow = await env.DB.prepare(`SELECT * FROM cms_liquid_imports WHERE id = ? LIMIT 1`)
      .bind(importId)
      .first()
      .catch(() => null);
  }

  const r2Key = String(importRow?.r2_key || body.r2_key || '').trim();
  const r2Bucket = String(importRow?.r2_bucket || body.r2_bucket || CMS_DEFAULT_R2_BUCKET).trim();
  const sourceName = String(importRow?.import_name || body.import_name || 'theme').trim();

  if (!r2Key) {
    const err = 'missing_r2_key_for_theme_archive';
    await markJobFailed(env, { importId, conversionId, err });
    return { ok: false, error: err };
  }

  const r2 = getR2(env, r2Bucket);
  if (!r2) {
    const err = 'R2 binding unavailable';
    await markJobFailed(env, { importId, conversionId, err });
    return { ok: false, error: err };
  }

  if (importId) {
    await env.DB.prepare(
      `UPDATE cms_liquid_imports SET status = 'processing', updated_at = ? WHERE id = ?`,
    )
      .bind(Math.floor(Date.now() / 1000), importId)
      .run()
      .catch(() => {});
  }
  if (conversionId) {
    await env.DB.prepare(`UPDATE cms_conversions SET status = 'processing', started_at = ? WHERE id = ?`)
      .bind(Math.floor(Date.now() / 1000), conversionId)
      .run()
      .catch(() => {});
  }

  try {
    const obj = await r2.get(r2Key);
    if (!obj) throw new Error(`archive_not_found:${r2Key}`);
    const buf = await obj.arrayBuffer();
    const entries = await extractThemeArchive(buf, sourceName);
    const liquidSections = findShopifyLiquidSections(entries);
    const stagingPrefix = importId
      ? `cms/liquid-imports/${importId}/extracted`
      : `cms/conversions/${conversionId}/extracted`;

    const stagedPaths = [];
    for (const e of entries.slice(0, 500)) {
      const safePath = String(e.path || '').replace(/\.\./g, '').replace(/^\/+/, '');
      if (!safePath) continue;
      const stageKey = `${stagingPrefix}/${safePath}`;
      await r2.put(stageKey, e.content).catch(() => {});
      stagedPaths.push(stageKey);
    }

    const sectionRows = [];
    if (importId && importRow?.id) {
      for (const sec of liquidSections) {
        const lsecId = `lsec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const stageKey = `${stagingPrefix}/${sec.path}`;
        const fileName = sec.path.split('/').pop() || sec.section_key;
        await env.DB.prepare(
          `INSERT INTO cms_liquid_sections
           (id, tenant_id, import_id, file_name, section_key, section_type, liquid_source, parse_status, created_at)
           VALUES (?, ?, ?, ?, ?, 'shopify_section', ?, 'inventory', unixepoch())`,
        )
          .bind(
            lsecId,
            tenantId || importRow.tenant_id || 'unknown',
            importId,
            fileName,
            sec.section_key,
            sec.liquid_source?.slice(0, 32000) || '',
          )
          .run()
          .catch(() => {});
        sectionRows.push({
          id: lsecId,
          section_key: sec.section_key,
          path: sec.path,
          r2_key: stageKey,
          file_name: fileName,
        });
      }
    } else {
      for (const sec of liquidSections) {
        sectionRows.push({
          section_key: sec.section_key,
          path: sec.path,
          r2_key: `${stagingPrefix}/${sec.path}`,
          file_name: sec.path.split('/').pop() || sec.section_key,
        });
      }
    }

    let resultJson = buildThemePackageManifest({
      importId,
      stagingPrefix,
      archiveR2Key: r2Key,
      entries,
      liquidSections,
      sectionRows,
    });

    if (importId) {
      const auditResult = await runThemePackagePythonAudit(env, {
        manifest: resultJson,
        liquidSections: liquidSections.map((sec, i) => ({
          section_key: sec.section_key,
          path: sec.path,
          liquid_source: sec.liquid_source,
          r2_key: sectionRows[i]?.r2_key,
        })),
        r2Bucket,
        projectSlug: importRow?.project_id,
        workspaceId: workspaceId || importRow?.workspace_id,
      }).catch(() => ({ ok: false, skipped: true }));

      if (auditResult?.ok) {
        const persisted = await persistThemePackageAudit(env, {
          importId,
          manifest: resultJson,
          auditResult,
          r2Bucket,
        }).catch(() => null);
        if (persisted?.manifest) resultJson = persisted.manifest;
      } else if (auditResult && !auditResult.skipped) {
        resultJson = {
          ...resultJson,
          python_audit_error: auditResult.error || 'audit_failed',
        };
      }
    }

    if (importId) {
      await env.DB.prepare(
        `UPDATE cms_liquid_imports
         SET status = 'inventory_ready',
             sections_found = ?,
             sections_mapped = 0,
             pages_created = 0,
             templates_found = ?,
             result_json = ?,
             completed_at = NULL,
             updated_at = ?
         WHERE id = ?`,
      )
        .bind(
          liquidSections.length,
          resultJson.templates?.length || entries.filter((e) => /templates\//i.test(e.path)).length,
          JSON.stringify(resultJson),
          Math.floor(Date.now() / 1000),
          importId,
        )
        .run();
    }
    if (conversionId) {
      await env.DB.prepare(
        `UPDATE cms_conversions
         SET status = 'completed',
             output_url = ?,
             error_message = NULL,
             completed_at = ?
         WHERE id = ?`,
      )
        .bind(stagingPrefix, Math.floor(Date.now() / 1000), conversionId)
        .run()
        .catch(() => {});
      await env.DB.prepare(
        `UPDATE cms_conversion_jobs SET status = 'completed', result_url = ? WHERE asset_id = ? OR id LIKE ?`,
      )
        .bind(stagingPrefix, conversionId, `%${conversionId}%`)
        .run()
        .catch(() => {});
    }

    emitInnerAnimalProEvent(env, {
      userId: importRow?.created_by || null,
      eventName: `liquid_import_inventory_ready:${importId || conversionId}:sections=${liquidSections.length}`,
    });

    return {
      ok: true,
      import_id: importId || null,
      conversion_id: conversionId || null,
      phase: 'inventory',
      status: 'inventory_ready',
      sections_found: liquidSections.length,
      sections_mapped: 0,
      pages_created: 0,
      staging_prefix: stagingPrefix,
      workspace_id: workspaceId || null,
      manifest: resultJson,
    };
  } catch (e) {
    const err = String(e?.message || e);
    await markJobFailed(env, { importId, conversionId, err });
    emitInnerAnimalProEvent(env, {
      userId: importRow?.created_by || null,
      eventName: `liquid_import_failed:${importId || conversionId}:${err.slice(0, 120)}`,
    });
    return { ok: false, error: err };
  }
}

/** @param {any} env @param {{ importId?: string, conversionId?: string, err: string }} opts */
async function markJobFailed(env, opts) {
  const now = Math.floor(Date.now() / 1000);
  if (opts.importId) {
    await env.DB.prepare(
      `UPDATE cms_liquid_imports SET status = 'failed', error_log = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(opts.err, now, opts.importId)
      .run()
      .catch(() => {});
  }
  if (opts.conversionId) {
    await env.DB.prepare(
      `UPDATE cms_conversions SET status = 'failed', error_message = ? WHERE id = ?`,
    )
      .bind(opts.err, opts.conversionId)
      .run()
      .catch(() => {});
  }
}

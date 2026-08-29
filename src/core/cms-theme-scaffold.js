/**
 * Scaffold cms_pages + published HTML from a Shopify theme import (templates/index.json).
 */
import { renderCmsSectionTreeHtml } from './cms-edit-safety.js';
import { CMS_DEFAULT_R2_BUCKET, getCmsR2Binding } from './cms-r2-binding.js';

import { findThemeTemplateEntry, parseShopifyTemplateJson, resolveThemeSectionPlan } from './agentsam/cms/packages/template-plan.js';

function cmsPageKey(workspaceId, projectSlug, pageSlug, variant) {
  return `cms/${workspaceId}/${projectSlug}/${pageSlug}/${variant}.html`;
}

/**
 * @param {any} env
 * @param {{
 *   tenantId: string,
 *   workspaceId: string,
 *   projectSlug: string,
 *   projectName: string,
 *   userId: string,
 *   personUuid?: string|null,
 *   importId: string,
 *   entries: Array<{ path: string, content: Uint8Array }>,
 *   liquidSections: Array<{ section_key: string, liquid_source?: string }>,
 * }} opts
 */
export async function scaffoldPublishedHomepageFromThemeImport(env, opts) {
  const projectSlug = String(opts.projectSlug || '').trim();
  const workspaceId = String(opts.workspaceId || '').trim();
  const tenantId = String(opts.tenantId || '').trim();
  const userId = String(opts.userId || '').trim();
  const personUuid = String(opts.personUuid || userId).trim();
  const projectName = String(opts.projectName || projectSlug || 'Home').trim();
  const importId = String(opts.importId || '').trim();
  const templateName = String(opts.templateName || 'index').trim() || 'index';
  const r2BucketName = String(opts.r2Bucket || CMS_DEFAULT_R2_BUCKET).trim();
  const db = opts.db || env?.DB;
  const updatePlatformImportRow = opts.updatePlatformImportRow !== false;

  if (!db || !projectSlug || !workspaceId) {
    return { ok: false, error: 'missing_db_or_project' };
  }

  const existing = await db.prepare(
    `SELECT id, slug FROM cms_pages
     WHERE workspace_id = ? AND project_slug = ? AND route_path = '/' AND status != 'archived'
     LIMIT 1`,
  )
    .bind(workspaceId, projectSlug)
    .first()
    .catch(() => null);

  const templateEntry = findThemeTemplateEntry(opts.entries || [], templateName);
  const templatePlan = templateEntry
    ? parseShopifyTemplateJson(textFromBytes(templateEntry.content))
    : null;
  let sectionPlan = resolveThemeSectionPlan(opts.liquidSections || [], templatePlan?.order || null);

  if (Array.isArray(opts.selectedSections) && opts.selectedSections.length) {
    const wanted = new Set(opts.selectedSections.map((s) => String(s).toLowerCase()));
    sectionPlan = sectionPlan.filter(
      (row) =>
        wanted.has(String(row.instance_key).toLowerCase()) ||
        wanted.has(String(row.section_type).toLowerCase()),
    );
  }

  if (!sectionPlan.length) {
    return { ok: false, error: 'no_sections_to_scaffold', sections_found: 0 };
  }

  const now = Math.floor(Date.now() / 1000);
  const homepageSlug = 'home';
  const pageId = existing?.id || crypto.randomUUID();
  const routePath = '/';

  const dbSections = [];
  for (const row of sectionPlan) {
    const sectionId = `sec_${projectSlug}_${row.instance_key}`.slice(0, 120);
    const sectionData = {
      headline: row.section_type.replace(/[-_]/g, ' '),
      shopify_section_type: row.section_type,
      shopify_instance_key: row.instance_key,
      shopify_settings: row.settings,
      liquid_import_id: importId,
      _scaffold: 'theme_import_v1',
    };
    dbSections.push({
      id: sectionId,
      section_type: row.section_type,
      section_name: row.instance_key,
      section_data: sectionData,
      sort_order: row.sort_order,
      is_visible: 1,
    });
  }

  const html = renderCmsSectionTreeHtml(dbSections, {}, { themeCss: '' });
  const r2Binding = getCmsR2Binding(env, r2BucketName);
  if (!r2Binding) return { ok: false, error: 'R2 storage unavailable' };

  const draftKey = cmsPageKey(workspaceId, projectSlug, homepageSlug, 'draft');
  const publishedKey = cmsPageKey(workspaceId, projectSlug, homepageSlug, 'published');
  const contentBuffer = new TextEncoder().encode(html);

  await r2Binding.put(draftKey, contentBuffer, {
    httpMetadata: { contentType: 'text/html' },
  });
  await r2Binding.put(publishedKey, contentBuffer, {
    httpMetadata: { contentType: 'text/html' },
  });

  if (!existing?.id) {
    await db.prepare(
      `INSERT INTO cms_pages (
         id, project_id, project_slug, slug, title, status, route_path, path, page_type,
         tenant_id, workspace_id, person_uuid, created_by, updated_by,
         r2_key, r2_bucket, content_type, content_size_bytes,
         seo_title, meta_description,
         created_at, updated_at, published_at
       ) VALUES (?, ?, ?, ?, ?, 'published', ?, ?, 'home', ?, ?, ?, ?, ?, ?, ?, 'text/html', ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        pageId,
        projectSlug,
        projectSlug,
        homepageSlug,
        projectName,
        routePath,
        routePath,
        tenantId,
        workspaceId,
        personUuid,
        userId,
        userId,
        publishedKey,
        r2BucketName,
        contentBuffer.byteLength,
        projectName,
        `${projectName} — imported Shopify theme`,
        now,
        now,
        now,
      )
      .run();
  } else {
    await db.prepare(
      `UPDATE cms_pages SET
         title = ?, status = 'published', r2_key = ?, r2_bucket = ?,
         content_size_bytes = ?, updated_by = ?, updated_at = ?, published_at = ?
       WHERE id = ?`,
    )
      .bind(projectName, publishedKey, r2BucketName, contentBuffer.byteLength, userId, now, now, pageId)
      .run();
    await db.prepare(`DELETE FROM cms_page_sections WHERE page_id = ?`).bind(pageId).run().catch(() => {});
  }

  for (const sec of dbSections) {
    await db.prepare(
      `INSERT INTO cms_page_sections
       (id, page_id, section_type, section_name, section_data, sort_order, is_visible, css_classes, custom_css, created_at_unix)
       VALUES (?, ?, ?, ?, ?, ?, 1, '', '', ?)`,
    )
      .bind(
        sec.id,
        pageId,
        sec.section_type,
        sec.section_name,
        JSON.stringify(sec.section_data || {}),
        sec.sort_order,
        now,
      )
      .run();
  }

  if (importId && updatePlatformImportRow && env?.DB) {
    await env.DB.prepare(
      `UPDATE cms_liquid_imports
       SET pages_created = 1, sections_mapped = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(sectionPlan.length, now, importId)
      .run()
      .catch(() => {});
  }

  return {
    ok: true,
    page_id: pageId,
    homepage_slug: homepageSlug,
    sections_mapped: sectionPlan.length,
    template_used: templateEntry ? `templates/${templateName}.json` : 'sections_only',
    published_r2_key: publishedKey,
  };
}

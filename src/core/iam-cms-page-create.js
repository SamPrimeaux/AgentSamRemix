/**
 * Create IAM marketing CMS pages on storefront R2 layout (pages/{slug}/index.html).
 * Save/Publish update R2 + D1 — no Worker redeploy required for content changes.
 */
import { renderCmsSectionTreeHtml } from './cms-edit-safety.js';
import { writeCmsDraftHtmlToR2 } from './cms-draft-artifact-host.js';
import { CMS_DEFAULT_R2_BUCKET, getCmsR2Binding } from './cms-r2-binding.js';
import { invalidateCmsBootstrapCache } from './cms-kv-cache.js';
import { buildCmsPageUrls } from './cms-preview-route.js';
import { iamMarketingPageR2Keys, IAM_STOREFRONT_BUCKET } from './iam-storefront-assets.js';

import { IAM_PAGE_BASELINE_SECTIONS } from './agentsam/cms/host/page-baseline-sections.js';

export { IAM_PAGE_BASELINE_SECTIONS };

function slugSegment(value, fallback = 'page') {
  return (
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback
  );
}

function isValidSlug(slug) {
  return /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/.test(slug) || /^[a-z0-9]$/.test(slug);
}

/**
 * @param {any} env
 * @param {{
 *   project_id: string,
 *   slug: string,
 *   title: string,
 *   route_path?: string,
 *   workspaceId: string,
 *   tenantId: string,
 *   userId: string,
 *   personUuid?: string,
 *   sections?: Array<Record<string, unknown>>,
 *   status?: string,
 * }} opts
 */
export async function createIamCmsPage(env, opts) {
  const projectId = String(opts.project_id || '').trim();
  const slug = slugSegment(opts.slug, 'page');
  const title = String(opts.title || slug).trim();
  const routePath = String(opts.route_path || `/${slug}`).trim().startsWith('/')
    ? String(opts.route_path || `/${slug}`).trim()
    : `/${String(opts.route_path || slug).trim()}`;
  const workspaceId = String(opts.workspaceId || '').trim();
  const tenantId = String(opts.tenantId || '').trim();
  const userId = String(opts.userId || '').trim();
  const personUuid = String(opts.personUuid || '').trim();
  const pageStatus = String(opts.status || 'draft').trim() === 'published' ? 'published' : 'draft';

  if (!env?.DB || !projectId || !slug || !title || !workspaceId || !tenantId || !userId) {
    return { ok: false, error: 'missing_context' };
  }
  if (!isValidSlug(slug)) {
    return { ok: false, error: 'invalid_slug' };
  }

  const dup = await env.DB.prepare(
    `SELECT id FROM cms_pages WHERE project_slug = ? AND (slug = ? OR route_path = ?) AND status != 'archived' LIMIT 1`,
  )
    .bind(projectId, slug, routePath)
    .first()
    .catch(() => null);
  if (dup?.id) {
    return { ok: false, error: 'route_exists', page_id: dup.id };
  }

  const keys = iamMarketingPageR2Keys(slug);
  const r2Bucket = IAM_STOREFRONT_BUCKET;
  const r2Binding = getCmsR2Binding(env, r2Bucket);
  if (!r2Binding) return { ok: false, error: 'R2 storage unavailable' };

  const sections = Array.isArray(opts.sections) && opts.sections.length
    ? opts.sections
    : IAM_PAGE_BASELINE_SECTIONS;

  const dbSections = sections.map((sec, i) => ({
    id:
      String(sec.id || '').trim() ||
      `sec_${slug}_${slugSegment(sec.section_name || sec.section_type, 'section')}`.slice(0, 120),
    section_type: String(sec.section_type || 'custom').trim(),
    section_name: String(sec.section_name || sec.section_type || `section-${i + 1}`).trim(),
    section_data:
      typeof sec.section_data === 'string'
        ? sec.section_data
        : JSON.stringify(sec.section_data || {}),
    sort_order: Number(sec.sort_order ?? (i + 1) * 10),
    is_visible: sec.is_visible === 0 || sec.is_visible === false ? 0 : 1,
  }));

  const scaffoldHtml = renderCmsSectionTreeHtml(
    dbSections.map((s) => ({
      ...s,
      section_data:
        typeof s.section_data === 'string'
          ? JSON.parse(s.section_data)
          : s.section_data,
    })),
    {},
  );

  const pageId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const contentBuffer = new TextEncoder().encode(scaffoldHtml);

  await r2Binding.put(keys.draft_key, contentBuffer, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  });
  if (pageStatus === 'published') {
    await r2Binding.put(keys.published_key, contentBuffer, {
      httpMetadata: { contentType: 'text/html; charset=utf-8' },
    });
  }

  await env.DB.prepare(
    `INSERT INTO cms_pages (
      id, project_id, project_slug, slug, title, status, route_path, path, page_type,
      tenant_id, workspace_id, person_uuid, created_by, updated_by,
      r2_key, r2_bucket, content_type, content_size_bytes,
      seo_title, meta_description, nav_visible,
      created_at, updated_at, published_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      pageId,
      projectId,
      projectId,
      slug,
      title,
      pageStatus,
      routePath,
      routePath,
      'custom',
      tenantId,
      workspaceId,
      personUuid || null,
      userId,
      userId,
      keys.published_key,
      r2Bucket,
      'text/html; charset=utf-8',
      contentBuffer.byteLength,
      title,
      `${title} — ${projectId}`,
      0,
      now,
      now,
      pageStatus === 'published' ? now : null,
    )
    .run();

  const createdSections = [];
  for (const sec of dbSections) {
    await env.DB.prepare(
      `INSERT INTO cms_page_sections
       (id, page_id, section_type, section_name, section_data, sort_order, is_visible, css_classes, custom_css, created_at_unix)
       VALUES (?, ?, ?, ?, ?, ?, ?, '', '', ?)`,
    )
      .bind(
        sec.id,
        pageId,
        sec.section_type,
        sec.section_name,
        sec.section_data,
        sec.sort_order,
        sec.is_visible,
        now,
      )
      .run();
    createdSections.push({
      id: sec.id,
      page_id: pageId,
      section_type: sec.section_type,
      section_name: sec.section_name,
      sort_order: sec.sort_order,
      is_visible: sec.is_visible,
    });
  }

  const page = {
    id: pageId,
    slug,
    title,
    route_path: routePath,
    project_slug: projectId,
    project_id: projectId,
    r2_key: keys.published_key,
    r2_bucket: r2Bucket,
    status: pageStatus,
    content_type: 'text/html; charset=utf-8',
  };

  await writeCmsDraftHtmlToR2(env, {
    workspaceId,
    page,
    userId,
  }).catch(() => null);

  invalidateCmsBootstrapCache(env, null, workspaceId, projectId);

  return {
    ok: true,
    id: pageId,
    r2_key: keys.published_key,
    draft_r2_key: keys.draft_key,
    route_path: routePath,
    status: pageStatus,
    sections: createdSections,
    preview_urls: buildCmsPageUrls(page, { projectSlug: projectId }),
  };
}

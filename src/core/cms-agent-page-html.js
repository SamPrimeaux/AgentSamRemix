/**
 * Agent-facing CMS HTML read/write helpers (R2 + D1, no HTTP round-trip).
 */
import {
  cmsPageHtmlKey as cmsPageKey,
  invalidateCmsBootstrap,
} from './cms-edit-safety.js';
import { writeCmsDraftHtmlToR2 } from './cms-draft-artifact-host.js';
import {
  readStorefrontAssetHtml,
  resolveIamPageHtmlKeys,
} from './iam-storefront-assets.js';
import { putCmsDraftCache } from './cms-kv-cache.js';
import { isFullHtmlDocument, normalizeFullPageHtml } from './cms-injected-sections.js';
import { buildCmsPageUrls } from './cms-preview-route.js';
import { CMS_DEFAULT_R2_BUCKET, getCmsR2Binding } from './cms-r2-binding.js';
import { writeCmsSectionDraftArtifact } from './agentsam/cms/adapters/cloudflare/section-artifacts.js';

/** @param {string} input */
async function cmsContentSha256(input) {
  const buf = new TextEncoder().encode(String(input));
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** @param {string} pageSlug @param {string} sectionName @param {string} hash */
function cmsSectionHtmlKey(pageSlug, sectionName, hash) {
  const slug = String(pageSlug || 'page')
    .replace(/^\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');
  const name = String(sectionName || 'section')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');
  return `cms/sections/${slug}/${name}/${hash.slice(0, 16)}.html`;
}

/**
 * @param {any} env
 * @param {{ page: Record<string, unknown>, workspaceId: string, variant?: 'draft'|'published' }} opts
 */
export async function readCmsPageHtmlFromR2(env, opts) {
  const page = opts.page || {};
  const workspaceId = String(opts.workspaceId || '').trim();
  const variant = opts.variant === 'published' ? 'published' : 'draft';
  const layout = resolveIamPageHtmlKeys(page, workspaceId, cmsPageKey);
  const r2Binding = getCmsR2Binding(env, layout.bucket);
  if (!r2Binding || !workspaceId) return { html: null, r2_key: null, byte_length: 0 };

  if (layout.mode === 'storefront_asset') {
    const out = await readStorefrontAssetHtml(r2Binding, {
      draft_key: layout.draft_key,
      published_key: layout.published_key,
    }, variant);
    return {
      ...out,
      storefront_asset_r2_key: layout.published_key,
      edit_mode: 'storefront_asset',
    };
  }

  const key = variant === 'published' ? layout.published_key : layout.draft_key;
  const obj = await r2Binding.get(key).catch(() => null);
  if (!obj) return { html: null, r2_key: key, byte_length: 0, edit_mode: 'cms' };
  const html = await obj.text();
  return { html, r2_key: key, byte_length: html.length, edit_mode: 'cms' };
}

/**
 * @param {any} env
 * @param {{
 *   page: Record<string, unknown>,
 *   pageId: string,
 *   workspaceId: string,
 *   userId: string,
 *   html: string,
 *   content_type?: string,
 *   title?: string | null,
 *   executionCtx?: unknown,
 * }} opts
 */
export async function saveCmsPageHtmlDraft(env, opts) {
  const page = opts.page || {};
  const pageId = String(opts.pageId || page.id || '').trim();
  const workspaceId = String(opts.workspaceId || '').trim();
  const userId = String(opts.userId || '').trim();
  const html = String(opts.html || '');
  const contentType = String(opts.content_type || page.content_type || 'text/html');

  if (!env?.DB || !pageId || !workspaceId || !userId) {
    return { ok: false, error: 'missing_context' };
  }
  if (!html.trim()) return { ok: false, error: 'html required' };
  if (html.length > 1_024_000) return { ok: false, error: 'html exceeds 1MB limit' };

  const layout = resolveIamPageHtmlKeys(page, workspaceId, cmsPageKey);
  const r2Binding = getCmsR2Binding(env, layout.bucket);
  if (!r2Binding) return { ok: false, error: 'R2 storage unavailable' };

  const normalized = isFullHtmlDocument(html) ? normalizeFullPageHtml(html) : html;
  const contentBuffer = new TextEncoder().encode(normalized);
  const draftKey = layout.draft_key;
  const publishedKey = layout.published_key;

  await r2Binding.put(draftKey, contentBuffer, {
    httpMetadata: { contentType },
  });

  if (layout.mode === 'storefront_asset' && layout.legacy_draft_key) {
    await r2Binding.put(layout.legacy_draft_key, contentBuffer, {
      httpMetadata: { contentType },
    }).catch(() => {});
  }

  await putCmsDraftCache(env, {
    pageId,
    userId,
    payload: {
      content_type: contentType,
      r2_key: draftKey,
      r2_bucket: layout.bucket,
      title: opts.title || null,
      byte_length: contentBuffer.byteLength,
      agent_applied: true,
    },
  });

  const wasPublished = String(page.status || '').trim().toLowerCase() === 'published';
  const r2KeyForDb = layout.mode === 'storefront_asset' ? publishedKey : (wasPublished ? publishedKey : draftKey);
  const nextStatus = wasPublished ? 'published' : 'draft';
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(`
    UPDATE cms_pages
    SET title = COALESCE(?, title),
        updated_by = ?,
        updated_at = ?,
        r2_key = ?,
        content_size_bytes = ?,
        status = ?
    WHERE id = ?
  `)
    .bind(opts.title || null, userId, now, r2KeyForDb, contentBuffer.byteLength, nextStatus, pageId)
    .run();

  const projectSlug = String(page.project_slug || page.project_id || '').trim();
  if (projectSlug) {
    invalidateCmsBootstrap(env, opts.executionCtx, workspaceId, projectSlug);
  }

  return {
    ok: true,
    page_id: pageId,
    draft_r2_key: draftKey,
    published_r2_key: publishedKey,
    live_r2_key: r2KeyForDb,
    storefront_asset_r2_key: layout.mode === 'storefront_asset' ? publishedKey : null,
    edit_mode: layout.mode,
    status: nextStatus,
    has_unpublished_draft: wasPublished,
    byte_length: contentBuffer.byteLength,
    agent_applied: true,
  };
}

/**
 * @param {any} env
 * @param {{
 *   page: Record<string, unknown>,
 *   pageId: string,
 *   workspaceId: string,
 *   userId: string,
 *   sectionName: string,
 *   sectionType?: string,
 *   html: string,
 *   position?: string,
 *   sectionId?: string,
 *   executionCtx?: unknown,
 * }} opts
 */
export async function saveCmsInjectedSection(env, opts) {
  const page = opts.page || {};
  const pageId = String(opts.pageId || page.id || '').trim();
  const workspaceId = String(opts.workspaceId || '').trim();
  const userId = String(opts.userId || '').trim();
  const sectionName = String(opts.sectionName || '').trim();
  const sectionType = String(opts.sectionType || 'custom').trim();
  const html = String(opts.html || '');
  const position = String(opts.position || 'end').trim();

  if (!env?.DB || !pageId || !workspaceId || !userId || !sectionName) {
    return { ok: false, error: 'page_id, section_name, and user required' };
  }
  if (!html.trim()) return { ok: false, error: 'html required' };

  const pageSlug = String(page.slug || page.route_path || pageId).replace(/^\//, '') || 'page';
  const hash = await cmsContentSha256(html);
  const r2Key = cmsSectionHtmlKey(pageSlug, sectionName, hash);
  const r2Bucket = CMS_DEFAULT_R2_BUCKET;
  const r2Binding = getCmsR2Binding(env, r2Bucket);
  if (!r2Binding) return { ok: false, error: 'R2 storage unavailable' };

  await r2Binding.put(r2Key, new TextEncoder().encode(html), {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  });

  const sectionData = {
    r2_key: r2Key,
    html_source: 'injected',
    inject_position: position,
    content_sha256: hash,
    full_page_document: isFullHtmlDocument(html),
    updated_at: Math.floor(Date.now() / 1000),
  };
  const payload = JSON.stringify(sectionData);

  let sectionId = String(opts.sectionId || '').trim();
  let existing = null;
  if (sectionId) {
    existing = await env.DB.prepare(
      `SELECT id FROM cms_page_sections WHERE id = ? AND page_id = ? LIMIT 1`,
    )
      .bind(sectionId, pageId)
      .first()
      .catch(() => null);
  }
  if (!existing) {
    existing = await env.DB.prepare(
      `SELECT id FROM cms_page_sections WHERE page_id = ? AND section_name = ? LIMIT 1`,
    )
      .bind(pageId, sectionName)
      .first()
      .catch(() => null);
  }

  sectionId = existing?.id
    ? String(existing.id)
    : sectionId || `sec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const sectionArtifact = await writeCmsSectionDraftArtifact(env, {
    pageId,
    sectionId,
    data: sectionData,
  });
  if (existing?.id) {
    await env.DB.prepare(
      `UPDATE cms_page_sections SET section_data='{}', section_type=?, draft_r2_key=?, r2_bucket=?, content_hash=?, updated_at=datetime('now') WHERE id=?`,
    ).bind(sectionType, sectionArtifact.r2_key, sectionArtifact.r2_bucket, sectionArtifact.content_hash, sectionId).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO cms_page_sections
       (id,page_id,section_type,section_name,section_data,sort_order,is_visible,created_at_unix,draft_r2_key,r2_bucket,content_hash,schema_version)
       VALUES (?,?,?,?,?, ?,1,?,?,?,?,1)`,
    ).bind(sectionId,pageId,sectionType,sectionName,'{}',position === 'start' ? 5 : 50,Math.floor(Date.now()/1000),sectionArtifact.r2_key,sectionArtifact.r2_bucket,sectionArtifact.content_hash).run();
  }

  await writeCmsDraftHtmlToR2(env, {
    workspaceId,
    page,
    userId,
    fullPageHtml: isFullHtmlDocument(html) ? normalizeFullPageHtml(html) : undefined,
  });

  const projectSlug = String(page.project_slug || page.project_id || '').trim();
  if (projectSlug) {
    invalidateCmsBootstrap(env, opts.executionCtx, workspaceId, projectSlug);
  }

  const tenantRow = await env.DB.prepare(`SELECT domain FROM cms_tenants WHERE slug = ? LIMIT 1`)
    .bind(projectSlug)
    .first()
    .catch(() => null);
  const previewUrls = buildCmsPageUrls(page, { domain: tenantRow?.domain || null, projectSlug });

  return {
    ok: true,
    page_id: pageId,
    section_id: sectionId,
    section_name: sectionName,
    r2_key: r2Key,
    created: !existing?.id,
    preview_urls: previewUrls,
    agent_applied: true,
  };
}

/**
 * @param {string} url
 * @param {{ expect_title?: string, expect_snippet?: string }} [opts]
 */
export async function verifyCmsLiveUrl(url, opts = {}) {
  const liveUrl = String(url || '').trim();
  if (!liveUrl) return { ok: false, error: 'url required' };

  let res;
  try {
    res = await fetch(liveUrl, {
      method: 'GET',
      headers: { Accept: 'text/html', 'User-Agent': 'InnerAnimalMedia-CMS-Verify/1.0' },
      redirect: 'follow',
    });
  } catch (e) {
    return { ok: false, error: `fetch_failed: ${e?.message || e}`, url: liveUrl };
  }

  const body = await res.text();
  const titleMatch = body.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : null;
  const isCleanCanvas = /Clean canvas/i.test(body) && body.length < 2000;
  const expectTitle = String(opts.expect_title || '').trim();
  const expectSnippet = String(opts.expect_snippet || '').trim();

  const checks = {
    http_status: res.status,
    byte_length: body.length,
    title,
    is_clean_canvas: isCleanCanvas,
    title_matches: expectTitle ? title?.includes(expectTitle) : null,
    snippet_found: expectSnippet ? body.includes(expectSnippet) : null,
  };

  const passed =
    res.status === 200 &&
    !isCleanCanvas &&
    body.length > 500 &&
    (expectTitle ? checks.title_matches === true : true) &&
    (expectSnippet ? checks.snippet_found === true : true);

  return {
    ok: passed,
    url: liveUrl,
    verified: passed,
    checks,
    agent_applied: true,
  };
}

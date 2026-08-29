import { resolveCmsBootstrapProjectSlug } from '../context/workspace-context.js';
import { assertCmsBootstrapAdapters, normalizeJsonObject } from './bootstrap-contract.js';
import { CMS_BOOTSTRAP_TTL_SEC, cmsBootstrapKey } from './cache-key.js';
import { buildCmsSiteManifest } from './site-manifest.js';
import { getCmsSiteThemeOverrides, applyCmsThemeOverrides } from '../theme/overrides.js';
import { buildCmsSchemaManifest } from '../registry/index.js';

function rows(result) {
  return result?.results || [];
}

function groupRowsBy(items, key, dataField) {
  const grouped = {};
  for (const item of items || []) {
    const groupKey = item?.[key];
    if (!groupKey) continue;
    if (!grouped[groupKey]) grouped[groupKey] = [];
    grouped[groupKey].push(
      dataField
        ? { ...item, [dataField]: normalizeJsonObject(item?.[dataField]) }
        : item,
    );
  }
  return grouped;
}

function buildThemeList(themeRows, activeThemeResolved) {
  const activeSlug = activeThemeResolved?.row?.slug || null;
  return (themeRows || []).map((theme) => ({
    ...theme,
    is_active: activeSlug ? theme.slug === activeSlug : !!theme.pref_id,
    css_vars: normalizeJsonObject(theme.css_vars_json),
  }));
}

const PLATFORM_WORKER = 'inneranimalmedia';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

/**
 * Resolve single-worker + R2 lanes for agentsam_project_context upsert.
 * Platform CMS defaults to IAM worker/bucket; client sites use siteConfig SSOT.
 * @param {Record<string, unknown>|null|undefined} siteConfig
 * @param {string|undefined|null} defaultR2Bucket
 */
export function resolveBootstrapProjectContextLanes(siteConfig, defaultR2Bucket) {
  const isPlatform = siteConfig?.cms_hosting !== 'client_worker';
  const workerName =
    trim(siteConfig?.worker_name) || (isPlatform ? PLATFORM_WORKER : '');
  const r2Bucket =
    trim(siteConfig?.r2_bucket) ||
    trim(defaultR2Bucket) ||
    (isPlatform ? PLATFORM_WORKER : workerName);
  return {
    workerName: workerName || PLATFORM_WORKER,
    r2Bucket: r2Bucket || PLATFORM_WORKER,
  };
}

function buildActiveTheme(themes, activeThemeResolved) {
  const row = activeThemeResolved?.row;
  if (!row) return themes.find((theme) => theme.is_active) || themes[0] || null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    theme_family: row.theme_family,
    css_r2_key: row.css_r2_key,
    compiled_css_hash: row.compiled_css_hash,
    monaco_theme: row.monaco_theme,
    is_active: true,
    resolved_from: activeThemeResolved.resolved_from,
    css_vars: normalizeJsonObject(row.css_vars_json),
  };
}

async function loadBootstrapRows(env, { tenantId, workspaceId, projectSlug }) {
  return Promise.all([
    env.DB.prepare(
      `SELECT id, project_slug, slug, route_path, title, status, page_type,
              sort_order, seo_title, meta_description, robots,
              r2_key, r2_bucket, published_at, updated_at
       FROM cms_pages
       WHERE tenant_id = ?
         AND (project_slug = ? OR project_id = ?)
         AND status != 'archived'
       ORDER BY sort_order, route_path`,
    ).bind(tenantId, projectSlug, projectSlug).all().catch(() => ({ results: [] })),
    env.DB.prepare(
      `SELECT s.id, s.page_id, s.section_type, s.section_name,
              s.section_data, s.sort_order, s.is_visible, s.updated_at,
              s.draft_r2_key, s.published_r2_key, s.r2_bucket, s.content_hash, s.published_hash, s.schema_version
       FROM cms_page_sections s
       JOIN cms_pages p ON p.id = s.page_id
       WHERE p.tenant_id = ?
         AND (p.project_slug = ? OR p.project_id = ?)
       ORDER BY s.sort_order`,
    ).bind(tenantId, projectSlug, projectSlug).all().catch(() => ({ results: [] })),
    env.DB.prepare(
      `SELECT c.id, c.section_id, c.component_type, c.component_data,
              c.sort_order, c.is_visible, c.updated_at
       FROM cms_section_components c
       JOIN cms_page_sections s ON s.id = c.section_id
       JOIN cms_pages p ON p.id = s.page_id
       WHERE p.tenant_id = ?
         AND (p.project_slug = ? OR p.project_id = ?)
       ORDER BY c.sort_order`,
    ).bind(tenantId, projectSlug, projectSlug).all().catch(() => ({ results: [] })),
    env.DB.prepare(
      `SELECT t.id, t.name, t.slug, t.theme_family, t.css_r2_key,
              t.compiled_css_hash, t.css_vars_json, t.tokens_json,
              t.monaco_theme, tp.id AS pref_id
       FROM cms_themes t
       LEFT JOIN cms_theme_preferences tp
         ON tp.theme_id = t.id AND tp.workspace_id = ? AND tp.is_active = 1
       WHERE t.status = 'active' ORDER BY tp.id DESC, t.sort_order LIMIT 50`,
    ).bind(workspaceId).all().catch(() => ({ results: [] })),
    env.DB.prepare(
      `SELECT id, menu_name, menu_type, menu_items FROM cms_navigation_menus WHERE project_id = ?`,
    ).bind(projectSlug).all().catch(() => ({ results: [] })),
    env.DB.prepare(
      `SELECT id, template_name, template_type, category, preview_image_url
       FROM cms_component_templates ORDER BY category, template_name`,
    ).all().catch(() => ({ results: [] })),
    env.DB.prepare(
      `SELECT id, import_name, status, sections_found, sections_mapped
       FROM cms_liquid_imports WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 10`,
    ).bind(tenantId).all().catch(() => ({ results: [] })),
    env.DB.prepare(
      `SELECT gs.id, gs.project_id, gs.site_name, gs.site_logo_url, gs.site_favicon_url,
              gs.contact_email, gs.analytics_id, gs.settings_json, gs.seo_defaults
       FROM cms_global_settings gs
       INNER JOIN cms_tenants t ON t.slug = ?
       WHERE gs.site_name = t.name OR CAST(gs.project_id AS TEXT) = t.slug
       LIMIT 1`,
    ).bind(projectSlug).first().catch(() => null),
    env.DB.prepare(
      `SELECT a.id, a.asset_id, a.meshy_task_id, a.model_type, a.prompt,
              a.glb_url, a.thumbnail_url, a.r2_key, a.r2_bucket, a.status, a.poly_count
       FROM cms_3d_assets a
       WHERE a.tenant_id = ? ORDER BY a.created_at DESC LIMIT 50`,
    ).bind(tenantId).all().catch(() => ({ results: [] })),
  ]);
}

async function loadFocusState(env, adapters, { focusPageId, userId }) {
  if (!focusPageId) return { activeDraft: null, liveSession: null };
  const draftRow = await env.DB.prepare(
    `SELECT draft_data, updated_at FROM cms_page_drafts WHERE page_id = ? AND user_id = ? LIMIT 1`,
  ).bind(focusPageId, userId).first().catch(() => null);
  const kvDraft = await adapters.getDraftCache(env, focusPageId, userId);
  let draftData = kvDraft?.draft_data || null;
  if (!draftData && draftRow?.draft_data) {
    try { draftData = JSON.parse(draftRow.draft_data); } catch { draftData = draftRow.draft_data; }
  }
  const activeDraft = draftData
    ? {
        page_id: focusPageId,
        draft_data: draftData,
        source: kvDraft ? 'kv' : 'd1',
        updated_at: draftRow?.updated_at || kvDraft?.cached_at || null,
      }
    : null;

  const sessionRow = await env.DB.prepare(
    `SELECT id, session_token, is_active, last_activity
     FROM cms_live_edit_sessions WHERE page_id = ? AND user_id = ? AND is_active = 1
     ORDER BY last_activity DESC LIMIT 1`,
  ).bind(focusPageId, userId).first().catch(() => null);
  const liveSession = sessionRow?.id
    ? {
        session_id: sessionRow.id,
        session_token: sessionRow.session_token,
        page_id: focusPageId,
        collab_room: `cms:${focusPageId}`,
        is_active: !!sessionRow.is_active,
        last_activity: sessionRow.last_activity,
      }
    : null;

  return { activeDraft, liveSession };
}

export async function buildCmsBootstrap({
  env,
  ctx,
  request,
  authUser,
  workspaceId,
  tenantId,
  explicitSlug = null,
  focusPageId = null,
  requestCache = {},
  defaultR2Bucket,
  storageBindings = {},
  adapters,
}) {
  assertCmsBootstrapAdapters(adapters);
  const resolved = await resolveCmsBootstrapProjectSlug(
    env,
    request,
    authUser,
    workspaceId,
    explicitSlug,
    requestCache,
  );
  if (resolved.error) {
    return {
      ok: false,
      status: resolved.error === 'CMS_PROJECT_UNRESOLVED' ? 404 : 400,
      body: {
        error: resolved.error,
        message: resolved.message || resolved.error,
        sites: resolved.context?.sites || [],
      },
    };
  }

  const projectSlug = resolved.project_slug;
  const cacheKey = cmsBootstrapKey(workspaceId, projectSlug);
  if (env.SESSION_CACHE && !focusPageId) {
    try {
      const cached = await env.SESSION_CACHE.get(cacheKey, { type: 'json' });
      if (cached) return { ok: true, status: 200, body: { ...cached, _cache: 'hit' } };
    } catch {}
  }

  const [
    pagesRes,
    sectionsRes,
    componentsRes,
    themesRes,
    navsRes,
    templatesRes,
    importsRes,
    globalSettingsRes,
    assets3dRes,
  ] = await loadBootstrapRows(env, { tenantId, workspaceId, projectSlug });

  const pages = adapters.enrichPages(rows(pagesRes));
  const sectionRows = rows(sectionsRes);
  const sections = typeof adapters.hydrateSections === 'function'
    ? await adapters.hydrateSections(env, sectionRows)
    : sectionRows;
  const components = rows(componentsRes);
  const sectionsByPage = groupRowsBy(sections, 'page_id', 'section_data');
  const componentsBySection = groupRowsBy(components, 'section_id', 'component_data');

  const activeThemeResolved = await adapters.resolveActiveThemeRow(env, {
    tenantId,
    authUser,
    workspaceId,
    projectId: projectSlug,
  });
  const themes = buildThemeList(rows(themesRes), activeThemeResolved);
  let activeTheme = buildActiveTheme(themes, activeThemeResolved);
  const siteThemeOverrides = await getCmsSiteThemeOverrides(env, { tenantId, workspaceId, projectSlug });
  activeTheme = applyCmsThemeOverrides(activeTheme, siteThemeOverrides);

  const { activeDraft, liveSession } = await loadFocusState(env, adapters, {
    focusPageId,
    userId: authUser.id,
  });

  const siteConfig = await adapters.resolveSiteConfig(env, workspaceId, projectSlug);
  const siteShell = await adapters.listSiteShell(env, projectSlug);
  const tenant = await adapters.resolveTenant(env, projectSlug);
  const domainResolved = await adapters.resolvePublicDomain(env, projectSlug, {
    workspaceId,
    workerName: siteConfig.worker_name,
  });
  const publicHost =
    String(domainResolved?.domain || '').trim() ||
    String(siteConfig.public_domain || '').trim() ||
    String(tenant?.domain || '').trim() ||
    null;
  const pagesWithUrls = pages.map((page) => ({
    ...page,
    ...adapters.buildPageUrls(page, { domain: publicHost }),
  }));
  const homePage = pagesWithUrls.find((page) => String(page.route_path || page.path || '').trim() === '/') || pagesWithUrls[0] || null;
  const manifest = buildCmsSiteManifest({
    projectSlug,
    siteConfig,
    tenant,
    domainResolved,
    pages: pagesWithUrls,
    homePage,
    cacheKey,
    defaultR2Bucket,
    storageBindings,
  });

  const schemaManifest = buildCmsSchemaManifest();
  const payload = {
    project_slug: projectSlug,
    workspace_id: workspaceId,
    workspace_name: resolved.context?.workspace_name || null,
    workspace_label: resolved.context?.ui_label || resolved.context?.workspace_name || null,
    resolved_from: resolved.context?.resolved_from || null,
    protocol_version: schemaManifest.protocol_version,
    schemas: {
      sections: schemaManifest.sections.map((row) => ({
        key: row.key,
        type: row.type,
        version: row.version,
        label: row.label,
        fields: row.fields,
        allowedBlocks: row.allowedBlocks,
        defaults: row.defaults,
        capabilities: row.capabilities,
      })),
      blocks: schemaManifest.blocks.map((row) => ({
        key: row.key,
        type: row.type,
        version: row.version,
        label: row.label,
        fields: row.fields,
        defaults: row.defaults,
        capabilities: row.capabilities,
      })),
      fields: schemaManifest.fields.map((row) => ({
        id: row.id,
        kind: row.kind,
        label: row.label,
      })),
    },
    ...manifest,
    sections_by_page: sectionsByPage,
    components_by_section: componentsBySection,
    active_theme: activeTheme,
    themes,
    nav_menus: rows(navsRes),
    component_templates: rows(templatesRes),
    liquid_imports: rows(importsRes),
    global_settings: globalSettingsRes || null,
    site_shell: siteShell,
    storefront_catalog: adapters.listStorefrontCatalog(),
    assets_3d: rows(assets3dRes),
    active_draft: activeDraft,
    live_session: liveSession,
  };

  const { workerName, r2Bucket } = resolveBootstrapProjectContextLanes(siteConfig, defaultR2Bucket);
  ctx?.waitUntil?.(
    adapters.upsertProjectContext(env, {
      tenantId,
      workspaceId,
      projectSlug,
      pageCount: pages.length,
      workerName,
      r2Bucket,
    }),
  );

  if (env.SESSION_CACHE) {
    ctx?.waitUntil?.(
      env.SESSION_CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: CMS_BOOTSTRAP_TTL_SEC }).catch(() => {}),
    );
  }

  return { ok: true, status: 200, body: payload };
}

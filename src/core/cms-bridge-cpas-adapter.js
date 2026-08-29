/**
 * CPAS fragment bridge — map PrimeTech CMS routes to companionscpas client worker APIs.
 * Client SSOT: companions D1 + R2 + KV (not IAM platform D1).
 */
import { proxyCmsBridgeRequest, isCmsBridgeEligible } from './cms-client-bridge.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function parseJsonSafe(raw, fallback = {}) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

/**
 * @param {unknown} raw
 * @param {Record<string, unknown>} siteConfig
 */
export function adaptCpasBootstrap(raw, siteConfig, sections = []) {
  const pages = Array.isArray(raw?.pages) ? raw.pages : [];
  const routeToId = new Map(pages.map((p) => [trim(p.route_path), trim(p.id)]));
  const sectionsByPage = {};

  for (const sec of sections) {
    const pageId = routeToId.get(trim(sec.page_route)) || trim(sec.page_id);
    if (!pageId) continue;
    if (!sectionsByPage[pageId]) sectionsByPage[pageId] = [];
    sectionsByPage[pageId].push({
      id: sec.id,
      page_id: pageId,
      section_type: sec.section_type || 'content',
      section_name: sec.section_key || sec.section_name || sec.heading || 'section',
      section_key: sec.section_key,
      page_route: sec.page_route,
      sort_order: Number(sec.sort_order) || 0,
      is_visible: sec.is_visible === 0 ? 0 : 1,
      section_data: {
        eyebrow: sec.eyebrow,
        heading: sec.heading,
        subheading: sec.subheading,
        body: sec.body,
        image_url: sec.image_url,
        cta_label: sec.cta_label,
        cta_href: sec.cta_href,
        config_json: parseJsonSafe(sec.config_json, {}),
      },
      updated_at: sec.updated_at,
    });
  }

  const domain =
    trim(siteConfig.public_domain) ||
    trim(raw?.brand?.domain) ||
    'companionsofcaddo.org';

  return {
    project_slug: trim(siteConfig.project_slug),
    cms_hosting: 'client_worker',
    api_profile: 'cpas_fragment',
    bridge_supported: true,
    public_domain: domain,
    tenant: {
      slug: trim(siteConfig.project_slug),
      name: trim(siteConfig.project_slug),
      domain,
    },
    pages: pages.map((p) => ({
      ...p,
      project_slug: trim(siteConfig.project_slug),
      slug: trim(p.slug) || trim(p.route_path)?.replace(/^\//, '') || 'home',
      live_url: p.route_path === '/' ? `https://${domain}/` : `https://${domain}${p.route_path}`,
    })),
    sections_by_page: sectionsByPage,
    themes: Array.isArray(raw?.themes) ? raw.themes : [],
    assets: Array.isArray(raw?.assets) ? raw.assets : [],
    assets_3d: Array.isArray(raw?.assets) ? raw.assets : [],
    nav_menus: Array.isArray(raw?.nav) ? raw.nav : [],
    imports: [],
    brand: raw?.brand || null,
    resolved_from: 'cpas_fragment_bridge',
  };
}

async function bridgeFetch(env, request, authUser, siteConfig, clientPath, init = {}) {
  const bridgePath = `/api/cms/bridge/cms${clientPath.startsWith('/') ? clientPath : `/${clientPath}`}`;
  const proxied = await proxyCmsBridgeRequest(env, request, authUser, siteConfig, bridgePath, init);
  return proxied;
}

async function fetchCpasBootstrap(env, request, authUser, siteConfig) {
  const [bootRes, secRes] = await Promise.all([
    bridgeFetch(env, request, authUser, siteConfig, '/api/cms/bootstrap'),
    bridgeFetch(env, request, authUser, siteConfig, '/api/cms/sections'),
  ]);
  if (!bootRes.ok) return bootRes;
  const sections = Array.isArray(secRes.body?.sections) ? secRes.body.sections : [];
  return {
    ok: true,
    status: 200,
    body: adaptCpasBootstrap(bootRes.body, siteConfig, sections),
  };
}

async function findCpasPageById(env, request, authUser, siteConfig, pageId) {
  const boot = await fetchCpasBootstrap(env, request, authUser, siteConfig);
  if (!boot.ok) return null;
  return (boot.body.pages || []).find((p) => trim(p.id) === trim(pageId)) || null;
}

async function fetchCpasPreviewHtml(env, request, authUser, siteConfig, route) {
  const routeQ = encodeURIComponent(route || '/');
  const proxied = await bridgeFetch(
    env,
    request,
    authUser,
    siteConfig,
    `/api/cms/preview?route=${routeQ}`,
    { method: 'GET', expectHtml: true },
  );
  if (!proxied.ok) return null;
  if (typeof proxied.body === 'string') return proxied.body;
  if (proxied.body?.raw) return proxied.body.raw;
  return null;
}

/**
 * Handle bridged CMS request for cpas_fragment before platform PrimeTech D1 handlers.
 * @returns {Response|null}
 */
export async function tryBridgedCpasCmsRequest(env, request, authUser, ctx) {
  const { path, method, url, siteConfig, projectSlug } = ctx;
  if (trim(siteConfig.api_profile).toLowerCase() !== 'cpas_fragment') return null;
  if (!isCmsBridgeEligible(siteConfig)) return null;

  const slug = trim(projectSlug);
  if (!slug) return null;

  const cfg = { ...siteConfig, project_slug: slug };

  if (path === '/api/cms/bootstrap' && method === 'GET') {
    const out = await fetchCpasBootstrap(env, request, authUser, cfg);
    return jsonBridgeResponse(out);
  }

  const previewUrlsMatch = path.match(/^\/api\/cms\/pages\/([^/]+)\/preview-urls$/);
  if (previewUrlsMatch && method === 'GET') {
    const pageId = previewUrlsMatch[1];
    const page = await findCpasPageById(env, request, authUser, cfg, pageId);
    if (!page) return jsonBridgeResponse({ ok: false, status: 404, body: { error: 'Page not found' } });
    const domain = trim(cfg.public_domain) || 'companionsofcaddo.org';
    const route = trim(page.route_path) || '/';
    const base = route === '/' ? `https://${domain}/` : `https://${domain}${route}`;
    return jsonBridgeResponse({
      ok: true,
      status: 200,
      body: {
        page_id: pageId,
        public_domain: domain,
        live_url: base,
        preview_draft_url: `${base}${base.includes('?') ? '&' : '?'}preview=draft&cms=1&page_id=${encodeURIComponent(pageId)}`,
        preview_published_url: `${base}${base.includes('?') ? '&' : '?'}preview=published&cms=1`,
        embed_url: `${base}${base.includes('?') ? '&' : '?'}cms=1`,
      },
    });
  }

  const pageDetailMatch = path.match(/^\/api\/cms\/pages\/([^/]+)$/);
  if (pageDetailMatch && method === 'GET') {
    const pageId = pageDetailMatch[1];
    const page = await findCpasPageById(env, request, authUser, cfg, pageId);
    if (!page) return jsonBridgeResponse({ ok: false, status: 404, body: { error: 'Page not found' } });
    const route = trim(page.route_path) || '/';
    const previewHtml = await fetchCpasPreviewHtml(env, request, authUser, cfg, route);
    const proxied = await bridgeFetch(
      env,
      request,
      authUser,
      cfg,
      `/api/cms/page?route=${encodeURIComponent(route)}`,
    );
    const sections = Array.isArray(proxied.body?.sections) ? proxied.body.sections : [];
    return jsonBridgeResponse({
      ok: true,
      status: 200,
      body: {
        page,
        sections,
        preview_html: previewHtml,
        cms_hosting: 'client_worker',
      },
    });
  }

  const publishMatch = path.match(/^\/api\/cms\/pages\/([^/]+)\/publish$/);
  if (publishMatch && method === 'POST') {
    const pageId = publishMatch[1];
    const page = await findCpasPageById(env, request, authUser, cfg, pageId);
    if (!page) return jsonBridgeResponse({ ok: false, status: 404, body: { error: 'Page not found' } });
    const proxied = await bridgeFetch(env, request, authUser, cfg, '/api/cms/publish', {
      method: 'POST',
      body: JSON.stringify({ route_path: page.route_path }),
    });
    return jsonBridgeResponse(proxied);
  }

  if (path === '/api/cms/sections/save-injected' && method === 'POST') {
    let body = {};
    try {
      body = await request.clone().json();
    } catch {
      return jsonBridgeResponse({ ok: false, status: 400, body: { error: 'invalid JSON' } });
    }
    const pageId = trim(body.page_id);
    const page = pageId ? await findCpasPageById(env, request, authUser, cfg, pageId) : null;
    const route = trim(page?.route_path) || '/';
    const sectionName = trim(body.section_name) || 'injected';
    const proxied = await bridgeFetch(env, request, authUser, cfg, '/api/cms/section/save', {
      method: 'POST',
      body: JSON.stringify({
        page_route: route,
        section_key: sectionName,
        section: {
          page_route: route,
          section_key: sectionName,
          section_type: body.section_type || 'html',
          body: body.html || '',
          heading: sectionName,
        },
      }),
    });
    return jsonBridgeResponse(proxied);
  }

  if (path.startsWith('/api/cms/bridge/')) return null;

  return null;
}

function jsonBridgeResponse(result) {
  if (!result) return null;
  const status = result.status || (result.ok ? 200 : 502);
  const body = result.body ?? { error: 'bridge_empty' };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

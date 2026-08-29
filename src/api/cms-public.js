/**
 * Unauthenticated read-only CMS endpoints for public marketing shells.
 */
import { jsonResponse } from '../core/auth.js';
import { loadPublishedCmsSectionsByRoute } from '../core/cms-public-page.js';
import { renderCmsPublishedSectionsHtml } from '../core/agentsam/cms/preview/render.js';

export async function handlePublicCmsApi(request, url, env) {
  if (request.method.toUpperCase() !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  const path = url.pathname.replace(/\/$/, '');
  if (path !== '/api/public/cms/page-sections') {
    return jsonResponse({ error: 'Not found' }, 404);
  }
  if (!env?.DB) return jsonResponse({ error: 'Database unavailable' }, 503);

  const route = String(url.searchParams.get('route') || '').trim();
  if (!route.startsWith('/')) return jsonResponse({ error: 'route must start with /' }, 400);

  const bundle = await loadPublishedCmsSectionsByRoute(env, route);
  const sections = (bundle.sections || []).map((s) => ({
    id: s.id,
    section_type: s.section_type,
    section_name: s.section_name,
    section_data: s.section_data,
    sort_order: s.sort_order,
    is_visible: s.is_visible,
  }));
  const wantHtml = url.searchParams.get('format') === 'html';
  if (wantHtml) {
    return new Response(renderCmsPublishedSectionsHtml(sections), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
      },
    });
  }
  return new Response(
    JSON.stringify({
      page: bundle.page,
      sections,
      source: bundle.source || null,
      publication_id: bundle.publication_id || null,
      /** Same registry-backed HTML used when format=html (proof of one render path). */
      rendered_html: renderCmsPublishedSectionsHtml(sections),
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
      },
    },
  );
}

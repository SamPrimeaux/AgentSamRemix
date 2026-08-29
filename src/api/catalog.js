/**
 * Public catalog endpoints (no session required).
 */
import { jsonResponse } from '../core/auth.js';

export async function handleCatalogApi(request, _url, env, _ctx) {
  const method = request.method.toUpperCase();
  if (method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  if (!env?.DB) {
    return jsonResponse({ error: 'DB not configured' }, 503);
  }
  try {
    const { results } = await env.DB.prepare(
      `SELECT *
       FROM integration_catalog
       WHERE COALESCE(is_active, 1) = 1
       ORDER BY category ASC, COALESCE(sort_order, 999) ASC, name ASC`,
    ).all();
    return jsonResponse({ integrations: results || [] });
  } catch (e) {
    console.warn('[catalog] integration_catalog read failed', e?.message || e);
    return jsonResponse({ error: e?.message ?? String(e), integrations: [] }, 500);
  }
}

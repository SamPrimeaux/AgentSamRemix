/**
 * Company profile API — branding SSOT (aligned with agentsam-sdk identity `company` table).
 */
import { jsonResponse, getAuthUser } from '../core/auth.js';
import { userCanInviteToTenant } from '../../backend/identity/workspace/authority.js';

const DEFAULT_COMPANY_SLUG = 'default';

function normalizeCompanyRow(row) {
  if (!row) return null;
  let meta = {};
  if (row.meta_json) {
    try {
      meta = JSON.parse(String(row.meta_json));
    } catch {
      meta = {};
    }
  }
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    legalName: row.legal_name || null,
    logoUrl: row.logo_url || null,
    faviconUrl: row.favicon_url || null,
    primaryColor: row.primary_color || null,
    authBgColor: row.auth_bg_color || null,
    supportEmail: row.support_email || null,
    websiteUrl: row.website_url || null,
    tagline: row.tagline || null,
    meta,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadCompany(env, slug = DEFAULT_COMPANY_SLUG) {
  if (!env?.DB) return null;
  const row = await env.DB.prepare(
    `SELECT id, slug, name, legal_name, logo_url, favicon_url, primary_color, auth_bg_color,
            support_email, website_url, tagline, meta_json, created_at, updated_at
     FROM company WHERE slug = ? LIMIT 1`,
  ).bind(slug).first();
  return normalizeCompanyRow(row);
}

export async function handleCompanyApi(request, url, env) {
  const path = url.pathname.toLowerCase();
  const method = request.method.toUpperCase();

  if (path !== '/api/company') {
    return jsonResponse({ ok: false, error: 'not_found' }, 404);
  }

  if (method === 'GET') {
    const slug = url.searchParams.get('slug') || DEFAULT_COMPANY_SLUG;
    const company = await loadCompany(env, slug);
    if (!company) return jsonResponse({ ok: false, error: 'company_not_found' }, 404);
    return jsonResponse({ ok: true, company });
  }

  if (method === 'PATCH') {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ ok: false, error: 'session_required' }, 401);
    if (!(await userCanInviteToTenant(env, authUser))) return jsonResponse({ ok: false, error: 'forbidden' }, 403);

    const body = await request.json().catch(() => ({}));
    const existing = await loadCompany(env, body.slug || DEFAULT_COMPANY_SLUG);
    const id = existing?.id || 'co_default';
    const slug = body.slug || existing?.slug || DEFAULT_COMPANY_SLUG;
    const ts = Math.floor(Date.now() / 1000);
    const metaJson = body.meta != null ? JSON.stringify(body.meta) : (existing?.meta ? JSON.stringify(existing.meta) : null);

    await env.DB.prepare(
      `INSERT INTO company (
        id, slug, name, legal_name, logo_url, favicon_url, primary_color, auth_bg_color,
        support_email, website_url, tagline, meta_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        slug = excluded.slug,
        name = excluded.name,
        legal_name = excluded.legal_name,
        logo_url = excluded.logo_url,
        favicon_url = excluded.favicon_url,
        primary_color = excluded.primary_color,
        auth_bg_color = excluded.auth_bg_color,
        support_email = excluded.support_email,
        website_url = excluded.website_url,
        tagline = excluded.tagline,
        meta_json = excluded.meta_json,
        updated_at = excluded.updated_at`,
    ).bind(
      id,
      slug,
      body.name ?? existing?.name ?? 'Inner Animal Media',
      body.legalName ?? existing?.legalName ?? null,
      body.logoUrl ?? existing?.logoUrl ?? null,
      body.faviconUrl ?? existing?.faviconUrl ?? null,
      body.primaryColor ?? existing?.primaryColor ?? null,
      body.authBgColor ?? existing?.authBgColor ?? null,
      body.supportEmail ?? existing?.supportEmail ?? null,
      body.websiteUrl ?? existing?.websiteUrl ?? null,
      body.tagline ?? existing?.tagline ?? null,
      metaJson,
      existing?.createdAt ?? ts,
      ts,
    ).run();

    const company = await loadCompany(env, slug);
    return jsonResponse({ ok: true, company });
  }

  return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
}

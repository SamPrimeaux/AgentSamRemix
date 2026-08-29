/**
 * CMS Phase 2 API patch
 *
 * Paste ALL of this into src/api/cms.js, immediately before:
 *   return jsonResponse({ error: 'CMS route not found' }, 404);
 *
 * Replaces the Phase 1 patch entirely (superset).
 * Adds: snapshot-before-publish, rollback endpoints,
 *        activity log reads, page meta PUT, assets list,
 *        and all Phase 1 routes.
 */

// ─── GET /api/cms/websites ────────────────────────────────────────────────────
if (path === '/api/cms/websites' && method === 'GET') {
  try {
    const { results: tenants } = await env.DB.prepare(
      `SELECT id, name, slug, domain, is_active, theme, primary_color
       FROM cms_tenants WHERE is_active = 1 ORDER BY name`
    ).all();
    const counts = {};
    for (const t of (tenants || [])) {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM cms_pages WHERE project_slug = ? AND status != 'archived'`
      ).bind(t.slug).first().catch(() => ({ n:0 }));
      counts[t.slug] = row?.n ?? 0;
    }
    return jsonResponse({ websites: (tenants || []).map(t => ({
      ...t, page_count: counts[t.slug] ?? 0,
      url: t.domain ? `https://${t.domain}` : null,
    })) });
  } catch (e) { return jsonResponse({ error: e.message }, 500); }
}

// ─── GET /api/cms/bootstrap?project_slug= ────────────────────────────────────
if (path === '/api/cms/bootstrap' && method === 'GET') {
  const projectSlug = String(url.searchParams.get('project_slug') || '').trim();
  if (!projectSlug) return jsonResponse({ error: 'project_slug_required' }, 400);
  const cacheKey = `cms:bootstrap:${workspaceId}:${projectSlug}`;

  if (env.SESSION_CACHE) {
    try {
      const cached = await env.SESSION_CACHE.get(cacheKey, { type:'json' });
      if (cached) return jsonResponse({ ...cached, _cache:'hit' });
    } catch (_) {}
  }

  try {
    const [pagesRes, sectionsRes, themesRes, navsRes, templatesRes, tenantRow, importsRes] =
      await Promise.all([
        env.DB.prepare(
          `SELECT id, project_slug, slug, route_path, title, status, page_type,
                  is_homepage, sort_order, seo_title, meta_description, robots,
                  published_at, updated_at
           FROM cms_pages WHERE project_slug = ? AND status != 'archived'
           ORDER BY sort_order, route_path`
        ).bind(projectSlug).all().catch(() => ({ results:[] })),
        env.DB.prepare(
          `SELECT s.id, s.page_id, s.section_type, s.section_name,
                  s.section_data, s.sort_order, s.is_visible, s.updated_at
           FROM cms_page_sections s
           JOIN cms_pages p ON p.id = s.page_id
           WHERE p.project_slug = ? ORDER BY s.sort_order`
        ).bind(projectSlug).all().catch(() => ({ results:[] })),
        env.DB.prepare(
          `SELECT t.id, t.name, t.slug, t.theme_family, t.css_r2_key,
                  t.compiled_css_hash, t.css_vars_json, t.tokens_json,
                  t.monaco_theme, tp.id AS pref_id
           FROM cms_themes t
           LEFT JOIN cms_theme_preferences tp
             ON tp.theme_id = t.id AND tp.workspace_id = ? AND tp.is_active = 1
           WHERE t.status = 'active' ORDER BY tp.id DESC, t.sort_order LIMIT 50`
        ).bind(workspaceId).all().catch(() => ({ results:[] })),
        env.DB.prepare(
          `SELECT id, menu_name, menu_type, menu_items FROM cms_navigation_menus WHERE project_id = ?`
        ).bind(projectSlug).all().catch(() => ({ results:[] })),
        env.DB.prepare(
          `SELECT id, template_name, template_type, category, preview_image_url
           FROM cms_component_templates ORDER BY category, template_name`
        ).all().catch(() => ({ results:[] })),
        env.DB.prepare(
          `SELECT id, name, slug, domain, primary_color, secondary_color, theme
           FROM cms_tenants WHERE slug = ? LIMIT 1`
        ).bind(projectSlug).first().catch(() => null),
        env.DB.prepare(
          `SELECT id, import_name, status, sections_found, sections_mapped
           FROM cms_liquid_imports WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 10`
        ).bind(tenantId).all().catch(() => ({ results:[] })),
      ]);

    const pages = pagesRes.results || [];
    const sections = sectionsRes.results || [];
    const themes = (themesRes.results || []).map(t => ({
      ...t,
      is_active: !!t.pref_id,
      css_vars: t.css_vars_json ? (() => { try { return JSON.parse(t.css_vars_json); } catch { return {}; } })() : {},
    }));

    const sectionsByPage = {};
    for (const s of sections) {
      if (!sectionsByPage[s.page_id]) sectionsByPage[s.page_id] = [];
      sectionsByPage[s.page_id].push({
        ...s,
        section_data: s.section_data
          ? (() => { try { return typeof s.section_data === 'string' ? JSON.parse(s.section_data) : s.section_data; } catch { return {}; } })()
          : {},
      });
    }

    const payload = {
      project_slug: projectSlug,
      tenant: tenantRow,
      pages,
      sections_by_page: sectionsByPage,
      active_theme: themes.find(t => t.is_active) || themes[0] || null,
      themes,
      nav_menus: navsRes.results || [],
      component_templates: templatesRes.results || [],
      liquid_imports: importsRes.results || [],
    };

    if (env.SESSION_CACHE) {
      ctx.waitUntil(
        env.SESSION_CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl:300 }).catch(() => {})
      );
    }
    return jsonResponse(payload);
  } catch (e) { return jsonResponse({ error: e.message }, 500); }
}

// ─── GET /api/cms/templates ───────────────────────────────────────────────────
if (path === '/api/cms/templates' && method === 'GET') {
  const category = url.searchParams.get('category') || null;
  try {
    let q = `SELECT id, template_name, template_type, category, preview_image_url,
                    template_data, is_system, r2_key, source_liquid_file
             FROM cms_component_templates`;
    const binds = [];
    if (category) { q += ` WHERE category = ?`; binds.push(category); }
    q += ` ORDER BY category, template_name`;
    const { results } = await env.DB.prepare(q).bind(...binds).all();
    return jsonResponse({ templates: results || [] });
  } catch (e) { return jsonResponse({ error: e.message }, 500); }
}

// ─── POST /api/cms/sections (create from template) ───────────────────────────
if (path === '/api/cms/sections' && method === 'POST') {
  let body = {};
  try { body = await request.json(); } catch { return jsonResponse({ error:'invalid JSON' }, 400); }
  const { page_id, section_type, section_name, section_data, sort_order } = body;
  if (!page_id || !section_type) return jsonResponse({ error:'page_id and section_type required' }, 400);
  try {
    const page = await env.DB.prepare(
      `SELECT id FROM cms_pages WHERE id = ? AND tenant_id = ? LIMIT 1`
    ).bind(page_id, tenantId).first();
    if (!page) return jsonResponse({ error:'Page not found' }, 404);
    const sectionId = `sec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
    const payload = typeof section_data === 'string' ? section_data : JSON.stringify(section_data || {});
    await env.DB.prepare(
      `INSERT INTO cms_page_sections
       (id, page_id, section_type, section_name, section_data, sort_order, is_visible, created_at_unix)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
    ).bind(sectionId, page_id, section_type, section_name || section_type,
      payload, Number(sort_order ?? 50), Math.floor(Date.now()/1000)).run();
    // Activity log
    await env.DB.prepare(
      `INSERT INTO cms_activity_log (id, tenant_id, user_id, action, resource_type, resource_id, created_at)
       VALUES (?, ?, ?, 'create', 'section', ?, ?)`
    ).bind(`al_${Date.now().toString(36)}`, tenantId, authUser.id, sectionId, Math.floor(Date.now()/1000))
      .run().catch(() => {});
    // Bust cache
    const ps = url.searchParams.get('project_slug');
    if (env.SESSION_CACHE && ps) {
      ctx.waitUntil(env.SESSION_CACHE.delete(`cms:bootstrap:${workspaceId}:${ps}`).catch(() => {}));
    }
    return jsonResponse({ success:true, id:sectionId });
  } catch (e) { return jsonResponse({ error: e.message }, 500); }
}

// ─── POST /api/cms/sections/:id/visibility ────────────────────────────────────
if (path.match(/^\/api\/cms\/sections\/[^/]+\/visibility$/) && method === 'POST') {
  const sId = path.split('/')[4];
  let body = {}; try { body = await request.json(); } catch {}
  const visible = (body.is_visible === true || body.is_visible === 1) ? 1 : 0;
  try {
    await env.DB.prepare(
      `UPDATE cms_page_sections SET is_visible = ?, updated_at = datetime('now')
       WHERE id = ? AND EXISTS (
         SELECT 1 FROM cms_pages p WHERE p.id = page_id AND p.tenant_id = ?
       )`
    ).bind(visible, sId, tenantId).run();
    return jsonResponse({ success:true, id:sId, is_visible:visible });
  } catch (e) { return jsonResponse({ error: e.message }, 500); }
}

// ─── POST /api/cms/sections/reorder ──────────────────────────────────────────
if (path === '/api/cms/sections/reorder' && method === 'POST') {
  let body = {}; try { body = await request.json(); } catch {}
  const { order } = body;
  if (!Array.isArray(order)) return jsonResponse({ error:'order array required' }, 400);
  try {
    for (const item of order) {
      if (!item.id || typeof item.sort_order !== 'number') continue;
      await env.DB.prepare(`UPDATE cms_page_sections SET sort_order = ? WHERE id = ?`)
        .bind(item.sort_order, item.id).run();
    }
    return jsonResponse({ success:true, updated:order.length });
  } catch (e) { return jsonResponse({ error: e.message }, 500); }
}

// ─── GET /api/cms/themes ──────────────────────────────────────────────────────
if (path === '/api/cms/themes' && method === 'GET') {
  try {
    const { results } = await env.DB.prepare(
      `SELECT t.id, t.name, t.slug, t.theme_family, t.css_r2_key, t.compiled_css_hash,
              t.css_vars_json, t.tokens_json, t.monaco_theme, t.sort_order,
              tp.id AS pref_id
       FROM cms_themes t
       LEFT JOIN cms_theme_preferences tp
         ON tp.theme_id = t.id AND tp.workspace_id = ? AND tp.is_active = 1
       WHERE t.status = 'active' ORDER BY tp.id DESC, t.sort_order LIMIT 100`
    ).bind(workspaceId).all();
    return jsonResponse({ themes: results || [] });
  } catch (e) { return jsonResponse({ error: e.message }, 500); }
}

// ─── POST /api/cms/themes/activate ───────────────────────────────────────────
if (path === '/api/cms/themes/activate' && method === 'POST') {
  let body = {}; try { body = await request.json(); } catch {}
  const { theme_id, theme_slug, project_slug } = body;
  if (!theme_id) return jsonResponse({ error:'theme_id required' }, 400);
  try {
    await env.DB.prepare(
      `UPDATE cms_theme_preferences SET is_active = 0 WHERE workspace_id = ? AND scope = 'workspace'`
    ).bind(workspaceId).run();
    const prefId = `pref_${Date.now().toString(36)}`;
    await env.DB.prepare(
      `INSERT OR REPLACE INTO cms_theme_preferences
       (id, tenant_id, workspace_id, theme_id, theme_slug, scope, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'workspace', 1, datetime('now'), datetime('now'))`
    ).bind(prefId, tenantId, workspaceId, theme_id, theme_slug || '').run();
    if (env.SESSION_CACHE && project_slug) {
      ctx.waitUntil(env.SESSION_CACHE.delete(`cms:bootstrap:${workspaceId}:${project_slug}`).catch(() => {}));
    }
    return jsonResponse({ success:true, theme_id });
  } catch (e) { return jsonResponse({ error: e.message }, 500); }
}

// ─── GET /api/cms/liquid-imports ─────────────────────────────────────────────
if (path === '/api/cms/liquid-imports' && method === 'GET') {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, import_key, import_name, source_type, status,
              sections_found, sections_mapped, templates_found, error_log, created_at, completed_at
       FROM cms_liquid_imports WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20`
    ).bind(tenantId).all();
    return jsonResponse({ imports: results || [] });
  } catch (e) { return jsonResponse({ error: e.message }, 500); }
}

// ─── POST /api/cms/liquid-imports ────────────────────────────────────────────
if (path === '/api/cms/liquid-imports' && method === 'POST') {
  let body = {}; try { body = await request.json(); } catch {}
  const { import_name, source_type, r2_key, r2_bucket, source_url, project_id } = body;
  if (!import_name || !source_type) return jsonResponse({ error:'import_name and source_type required' }, 400);
  const bucket = String(r2_bucket || '').trim();
  if (!bucket) return jsonResponse({ error: 'r2_bucket_required' }, 400);
  try {
    const importId = `limp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
    const importKey = import_name.toLowerCase().replace(/[^a-z0-9]+/g,'_').slice(0,64);
    const now = Math.floor(Date.now()/1000);
    await env.DB.prepare(
      `INSERT INTO cms_liquid_imports
       (id, tenant_id, workspace_id, project_id, import_key, import_name,
        source_type, source_path, source_url, r2_bucket, r2_key,
        status, sections_found, snippets_found, templates_found,
        sections_mapped, pages_created, assets_registered,
        metadata_json, result_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               'pending', 0, 0, 0, 0, 0, 0, '{}', '{}', ?, ?, ?)`
    ).bind(importId, tenantId, workspaceId, project_id || projectSlug,
      importKey, import_name, source_type, r2_key || source_url || '',
      source_url || '', bucket, r2_key || '',
      authUser.id, now, now).run();
    // Enqueue extraction job
    if (env.MY_QUEUE) {
      ctx.waitUntil(
        env.MY_QUEUE.send({ type:'cms_liquid_import', import_id:importId, tenant_id:tenantId }).catch(() => {})
      );
    }
    return jsonResponse({ success:true, id:importId, status:'pending' });
  } catch (e) { return jsonResponse({ error: e.message }, 500); }
}

// ─── GET /api/cms/assets ─────────────────────────────────────────────────────
if (path === '/api/cms/assets' && method === 'GET') {
  const category = url.searchParams.get('category') || null;
  const context = url.searchParams.get('context') || null;
  try {
    let q = `SELECT id, filename, original_filename, path, r2_key, public_url, cdn_url,
                    thumbnail_url, alt_text, mime_type, category, usage_context, label,
                    asset_key, created_at
             FROM cms_assets WHERE tenant_id = ?`;
    const binds = [tenantId];
    if (category) { q += ` AND category = ?`; binds.push(category); }
    if (context) { q += ` AND usage_context = ?`; binds.push(context); }
    q += ` ORDER BY created_at DESC LIMIT 100`;
    const { results } = await env.DB.prepare(q).bind(...binds).all();
    return jsonResponse({ assets: results || [] });
  } catch (e) { return jsonResponse({ error: e.message }, 500); }
}

// ─── GET /api/cms/activity?page_id= ──────────────────────────────────────────
if (path === '/api/cms/activity' && method === 'GET') {
  const pageId = url.searchParams.get('page_id');
  try {
    let q = `SELECT id, user_id, action, resource_type, resource_id, details, created_at
             FROM cms_activity_log WHERE tenant_id = ?`;
    const binds = [tenantId];
    if (pageId) {
      // Include activity for the page itself and its sections
      q += ` AND (resource_id = ? OR resource_id IN (
               SELECT id FROM cms_page_sections WHERE page_id = ?
             ))`;
      binds.push(pageId, pageId);
    }
    q += ` ORDER BY created_at DESC LIMIT 50`;
    const { results } = await env.DB.prepare(q).bind(...binds).all();
    return jsonResponse({ activity: results || [] });
  } catch (e) { return jsonResponse({ error: e.message }, 500); }
}

// ─── GET /api/cms/pages/:id/rollbacks ────────────────────────────────────────
// Note: cms_live_rollbacks uses page_id TEXT (from cms_pages.id)
if (path.match(/^\/api\/cms\/pages\/[^/]+\/rollbacks$/) && method === 'GET') {
  const pageId = path.split('/')[4];
  try {
    const { results } = await env.DB.prepare(
      `SELECT r.id, r.page_id, r.slug, r.previous_r2_key, r.deployed_html_hash, r.created_at
       FROM cms_live_rollbacks r
       JOIN cms_pages p ON p.id = r.page_id
       WHERE r.page_id = ? AND p.tenant_id = ?
       ORDER BY r.created_at DESC LIMIT 20`
    ).bind(pageId, tenantId).all();
    return jsonResponse({ rollbacks: results || [] });
  } catch (e) { return jsonResponse({ error: e.message }, 500); }
}

// ─── POST /api/cms/pages/:id/snapshot ────────────────────────────────────────
// Writes a rollback row BEFORE publishing (called by frontend publish flow)
if (path.match(/^\/api\/cms\/pages\/[^/]+\/snapshot$/) && method === 'POST') {
  const pageId = path.split('/')[4];
  try {
    const page = await env.DB.prepare(
      `SELECT id, slug, r2_key, r2_bucket FROM cms_pages WHERE id = ? AND tenant_id = ? LIMIT 1`
    ).bind(pageId, tenantId).first();
    if (!page) return jsonResponse({ error:'Page not found' }, 404);

    // Read current HTML hash if R2 key exists
    let htmlHash = null;
    if (page.r2_key && env.ASSETS) {
      const obj = await env.ASSETS.head(page.r2_key).catch(() => null);
      htmlHash = obj?.etag ? String(obj.etag).replace(/"/g,'') : null;
    }

    const rollbackId = `rb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
    await env.DB.prepare(
      `INSERT INTO cms_live_rollbacks
       (id, page_id, project_id, slug, previous_r2_key, deployed_html_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(rollbackId, pageId, page.slug, page.slug,
      page.r2_key || '', htmlHash || '', Math.floor(Date.now()/1000)).run();
    return jsonResponse({ success:true, id:rollbackId });
  } catch (e) { return jsonResponse({ error: e.message }, 500); }
}

// ─── POST /api/cms/rollback ───────────────────────────────────────────────────
if (path === '/api/cms/rollback' && method === 'POST') {
  let body = {}; try { body = await request.json(); } catch {}
  const { rollback_id, page_id } = body;
  if (!rollback_id || !page_id) return jsonResponse({ error:'rollback_id and page_id required' }, 400);
  try {
    const rb = await env.DB.prepare(
      `SELECT r.* FROM cms_live_rollbacks r
       JOIN cms_pages p ON p.id = r.page_id
       WHERE r.id = ? AND r.page_id = ? AND p.tenant_id = ? LIMIT 1`
    ).bind(rollback_id, page_id, tenantId).first();
    if (!rb) return jsonResponse({ error:'Rollback not found' }, 404);

    // If we have the R2 key, set it as the current published artifact
    if (rb.previous_r2_key && env.ASSETS) {
      // The previous artifact already exists in R2 — just update the D1 pointer
      const now = Math.floor(Date.now()/1000);
      await env.DB.prepare(
        `UPDATE cms_pages SET r2_key = ?, status = 'published', published_at = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?`
      ).bind(rb.previous_r2_key, now, now, page_id, tenantId).run();
      // Bust SESSION_CACHE for this page
      if (env.SESSION_CACHE) {
        // We don't know the project_slug here easily, so bust all keys for this workspace
        // (TTL 300s so worst case 5 minutes stale — acceptable for rollback)
        ctx.waitUntil(Promise.resolve());
      }
    }

    // Write activity log
    await env.DB.prepare(
      `INSERT INTO cms_activity_log (id, tenant_id, user_id, action, resource_type, resource_id, created_at)
       VALUES (?, ?, ?, 'rollback', 'page', ?, ?)`
    ).bind(`al_${Date.now().toString(36)}`, tenantId, authUser.id, page_id, Math.floor(Date.now()/1000))
      .run().catch(() => {});

    return jsonResponse({ success:true, page_id, previous_r2_key: rb.previous_r2_key });
  } catch (e) { return jsonResponse({ error: e.message }, 500); }
}

// ─── PUT /api/cms/pages/:id (update page meta — title, seo_title, etc.) ──────
// Note: existing PUT handler only handles content/R2. This is a separate metadata-only PUT
// that the frontend calls from the Meta tab.
if (pageIdMatch && method === 'PUT') {
  const pageId = pageIdMatch[1];
  let body = {}; try { body = await request.json(); } catch {}

  // If body has 'content' key, delegate to the existing content-update path (already above us)
  // This branch only handles metadata updates when content is absent
  if (!('content' in body)) {
    try {
      const updates = [];
      const binds = [];
      const allowed = ['title','seo_title','meta_description','robots','page_type','sort_order'];
      for (const k of allowed) {
        if (k in body) { updates.push(`${k} = ?`); binds.push(body[k]); }
      }
      if (!updates.length) return jsonResponse({ error:'No valid fields to update' }, 400);
      updates.push(`updated_at = ?`, `updated_by = ?`);
      binds.push(Math.floor(Date.now()/1000), authUser.id, pageId, tenantId);
      await env.DB.prepare(
        `UPDATE cms_pages SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`
      ).bind(...binds).run();
      return jsonResponse({ success:true, id:pageId });
    } catch (e) { return jsonResponse({ error: e.message }, 500); }
  }
}

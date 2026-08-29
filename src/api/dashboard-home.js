/**
 * Dashboard home — quick-start tiles (/api/dashboard/home).
 */
import { jsonResponse } from '../core/auth.js';
import { handleConnectTilesApi } from './dashboard-connect-tiles.js';
import { authorizeWorkspaceAccess } from '../core/workspace-access.js';

const PLATFORM_DEFAULT_WS = 'platform_default';
const VALID_TILE_SIZES = new Set(['sm', 'md', 'lg']);

function parseJson(raw, fallback = {}) {
  if (raw == null || raw === '') return { ...fallback };
  if (typeof raw === 'object') return raw;
  try {
    const o = JSON.parse(String(raw));
    return typeof o === 'object' && o !== null ? o : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function mapTileRow(row) {
  const sizeRaw = row.tile_size != null ? String(row.tile_size).toLowerCase() : 'md';
  const scaleRaw = Number(row.icon_scale);
  const iconScale = Number.isFinite(scaleRaw) ? Math.min(1.2, Math.max(0.5, scaleRaw)) : 1;
  return {
    id: String(row.id),
    tile_key: String(row.tile_key),
    title: String(row.title || ''),
    cta_label: String(row.cta_label || 'Open'),
    path: String(row.path || '/dashboard/agent'),
    image_url: row.image_url ? String(row.image_url) : null,
    tile_size: VALID_TILE_SIZES.has(sizeRaw) ? sizeRaw : 'md',
    icon_scale: iconScale,
    icon_bg: row.icon_bg != null && String(row.icon_bg).trim() ? String(row.icon_bg).trim() : null,
    sort_order: Number(row.sort_order) || 0,
    is_enabled: Number(row.is_enabled) === 1,
  };
}

async function selectHomeTiles(db, workspaceId) {
  const ws = String(workspaceId || '').trim();
  const sqlWithSize = `SELECT id, workspace_id, tile_key, title, cta_label, path, image_url, tile_size, icon_scale, icon_bg, sort_order, is_enabled
         FROM dashboard_home_tiles
         WHERE workspace_id = ? AND is_enabled = 1
         ORDER BY sort_order ASC, tile_key ASC`;
  const sqlLegacySize = `SELECT id, workspace_id, tile_key, title, cta_label, path, image_url, tile_size, sort_order, is_enabled
         FROM dashboard_home_tiles
         WHERE workspace_id = ? AND is_enabled = 1
         ORDER BY sort_order ASC, tile_key ASC`;
  const sqlLegacy = `SELECT id, workspace_id, tile_key, title, cta_label, path, image_url, sort_order, is_enabled
         FROM dashboard_home_tiles
         WHERE workspace_id = ? AND is_enabled = 1
         ORDER BY sort_order ASC, tile_key ASC`;
  try {
    const { results } = await db.prepare(sqlWithSize).bind(ws).all();
    return results || [];
  } catch {
    try {
      const { results } = await db.prepare(sqlLegacySize).bind(ws).all();
      return results || [];
    } catch {
      const { results } = await db.prepare(sqlLegacy).bind(ws).all();
      return results || [];
    }
  }
}

async function loadTilesForWorkspace(db, workspaceId) {
  const ws = String(workspaceId || '').trim();
  if (!ws) return [];
  try {
    const results = await selectHomeTiles(db, ws);
    if (results?.length) return results.map(mapTileRow);
  } catch {
    /* table may not exist yet */
  }
  try {
    const results = await selectHomeTiles(db, PLATFORM_DEFAULT_WS);
    return (results || []).map(mapTileRow);
  } catch {
    return [];
  }
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {any} authUser
 * @param {string} pathLower
 * @param {string} method
 */
export async function handleDashboardHomeApi(request, env, authUser, pathLower, method) {
  if (!pathLower.startsWith('/api/dashboard/home')) return null;

  if (!env?.DB) return jsonResponse({ ok: false, error: 'db_unavailable' }, 503);

  if (pathLower === '/api/dashboard/home/connect-tiles') {
    return handleConnectTilesApi(request, env, authUser, method);
  }

  const tenantId = authUser?.tenant_id ? String(authUser.tenant_id) : null;

  if (pathLower === '/api/dashboard/home' && method === 'GET') {
    const url = new URL(request.url);
    const workspaceId =
      String(url.searchParams.get('workspace_id') || authUser?.active_workspace_id || '').trim();
    if (!workspaceId) return jsonResponse({ ok: false, error: 'workspace_required' }, 400);
    if (!(await authorizeWorkspaceAccess(env, authUser?.id, workspaceId))) {
      return jsonResponse({ ok: false, error: 'workspace_not_allowed' }, 403);
    }
    const tiles = await loadTilesForWorkspace(env.DB, workspaceId);
    return jsonResponse({
      ok: true,
      workspace_id: workspaceId,
      tiles,
      editable: true,
      updated_at: new Date().toISOString(),
    });
  }

  if (pathLower === '/api/dashboard/home' && method === 'PUT') {
    const body = await request.json().catch(() => ({}));
    const workspaceId = String(body.workspace_id || authUser?.active_workspace_id || '').trim();
    if (!workspaceId) return jsonResponse({ ok: false, error: 'workspace_required' }, 400);
    if (!(await authorizeWorkspaceAccess(env, authUser?.id, workspaceId))) {
      return jsonResponse({ ok: false, error: 'workspace_not_allowed' }, 403);
    }
    const tiles = Array.isArray(body.tiles) ? body.tiles : [];
    if (!tiles.length) return jsonResponse({ ok: false, error: 'tiles_required' }, 400);

    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < tiles.length; i += 1) {
      const t = tiles[i] || {};
      const tileKey = String(t.tile_key || t.id || '').trim();
      const title = String(t.title || '').trim();
      const path = String(t.path || '').trim();
      if (!tileKey || !title || !path) continue;
      const id = `dht_${workspaceId.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24)}_${tileKey.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32)}`;
      const cta = String(t.cta_label || 'Open').trim() || 'Open';
      const imageUrl = t.image_url != null ? String(t.image_url).trim() || null : null;
      const sortOrder = Number.isFinite(Number(t.sort_order)) ? Number(t.sort_order) : i * 10;
      const enabled = t.is_enabled === false || t.is_enabled === 0 ? 0 : 1;
      const sizeRaw = String(t.tile_size || 'md').toLowerCase();
      const tileSize = VALID_TILE_SIZES.has(sizeRaw) ? sizeRaw : 'md';
      const scaleRaw = Number(t.icon_scale);
      const iconScale = Number.isFinite(scaleRaw) ? Math.min(1.2, Math.max(0.5, scaleRaw)) : 1;
      const iconBg = t.icon_bg != null && String(t.icon_bg).trim() ? String(t.icon_bg).trim() : null;
      try {
        await env.DB
          .prepare(
            `INSERT INTO dashboard_home_tiles (
               id, workspace_id, tile_key, title, cta_label, path, image_url, tile_size, icon_scale, icon_bg, sort_order, is_enabled, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(workspace_id, tile_key) DO UPDATE SET
               title = excluded.title,
               cta_label = excluded.cta_label,
               path = excluded.path,
               image_url = excluded.image_url,
               tile_size = excluded.tile_size,
               icon_scale = excluded.icon_scale,
               icon_bg = excluded.icon_bg,
               sort_order = excluded.sort_order,
               is_enabled = excluded.is_enabled,
               updated_at = excluded.updated_at`,
          )
          .bind(id, workspaceId, tileKey, title, cta, path, imageUrl, tileSize, iconScale, iconBg, sortOrder, enabled, now, now)
          .run();
      } catch {
        try {
          await env.DB
            .prepare(
              `INSERT INTO dashboard_home_tiles (
                 id, workspace_id, tile_key, title, cta_label, path, image_url, tile_size, sort_order, is_enabled, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(workspace_id, tile_key) DO UPDATE SET
                 title = excluded.title,
                 cta_label = excluded.cta_label,
                 path = excluded.path,
                 image_url = excluded.image_url,
                 tile_size = excluded.tile_size,
                 sort_order = excluded.sort_order,
                 is_enabled = excluded.is_enabled,
                 updated_at = excluded.updated_at`,
            )
            .bind(id, workspaceId, tileKey, title, cta, path, imageUrl, tileSize, sortOrder, enabled, now, now)
            .run();
        } catch {
          await env.DB
            .prepare(
              `INSERT INTO dashboard_home_tiles (
                 id, workspace_id, tile_key, title, cta_label, path, image_url, sort_order, is_enabled, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(workspace_id, tile_key) DO UPDATE SET
                 title = excluded.title,
                 cta_label = excluded.cta_label,
                 path = excluded.path,
                 image_url = excluded.image_url,
                 sort_order = excluded.sort_order,
                 is_enabled = excluded.is_enabled,
                 updated_at = excluded.updated_at`,
            )
            .bind(id, workspaceId, tileKey, title, cta, path, imageUrl, sortOrder, enabled, now, now)
            .run();
        }
      }
    }

    const next = await loadTilesForWorkspace(env.DB, workspaceId);
    return jsonResponse({ ok: true, workspace_id: workspaceId, tiles: next });
  }

  return jsonResponse({ ok: false, error: 'not_found' }, 404);
}

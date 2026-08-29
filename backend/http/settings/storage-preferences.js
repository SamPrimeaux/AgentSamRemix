/**
 * Per-provider storage preference settings (R2, GitHub, Google Drive, Supabase, S3).
 * - GET   /api/settings/storage-preferences
 * - PATCH /api/settings/storage-preferences
 * Deconstructed from src/api/settings.js (Lane D peel D4, no behavior change).
 */
import { jsonResponse } from '../agentsam/shared.js';
import { fetchAuthUserTenantId, fallbackSystemTenantId } from '../../identity/users/tenant.js';

function parseJsonSafe(str, fallback = {}) {
  if (str == null || str === '') return { ...fallback };
  try {
    const o = typeof str === 'string' ? JSON.parse(str) : str;
    return typeof o === 'object' && o !== null ? o : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

export async function handleSettingsStoragePrefsRoutes(request, env, ctx, authContext) {
  void ctx;
  const { authUser, pathLower, method } = authContext || {};
  if (!authUser) return null;

  const isStoragePrefsPath = pathLower === '/api/settings/storage-preferences';
  if (!isStoragePrefsPath) return null;

  const STORAGE_PROVIDER_PREFS_ALLOWED = ['r2', 'github', 'google_drive', 'supabase', 's3'];

  function maskStorageProviderPrefsRow(row) {
    if (!row || typeof row !== 'object') return row;
    const prefs = parseJsonSafe(row.preferences_json, {});
    const out = { ...row, preferences_json: { ...prefs } };
    const p = out.preferences_json;
    if (p.secret_access_key != null && String(p.secret_access_key).trim() !== '') {
      p.secret_access_key = '********';
    }
    if (p.access_key_id != null && String(p.access_key_id).length > 6) {
      const ak = String(p.access_key_id);
      p.access_key_id = `${ak.slice(0, 4)}…${ak.slice(-4)}`;
    }
    return out;
  }

  // ── /api/settings/storage-preferences (per-provider rows) ───────────────
  if (pathLower === '/api/settings/storage-preferences' && method === 'GET') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const uid = String(authUser.id || '').trim();
    try {
      const { results } = await env.DB.prepare(
        `SELECT user_id, tenant_id, workspace_id, provider, preferences_json, updated_at
         FROM user_storage_provider_preferences
         WHERE user_id = ?
         ORDER BY provider ASC`,
      )
        .bind(uid)
        .all();
      let oauth_providers = [];
      try {
        const tr = await env.DB.prepare(
          `SELECT DISTINCT lower(provider) AS p FROM user_oauth_tokens WHERE user_id = ?`,
        )
          .bind(uid)
          .all();
        oauth_providers = (tr.results || []).map((r) => String(r.p || '').toLowerCase()).filter(Boolean);
      } catch (_) {
        oauth_providers = [];
      }
      return jsonResponse({
        preferences: (results || []).map(maskStorageProviderPrefsRow),
        oauth_providers,
      });
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes('no such table')) {
        return jsonResponse(
          {
            error: 'user_storage_provider_preferences missing',
            hint: 'Apply migrations/289_storage_provider_prefs_general_ui.sql',
            preferences: [],
            oauth_providers: [],
          },
          503,
        );
      }
      return jsonResponse({ error: msg }, 500);
    }
  }

  if (pathLower === '/api/settings/storage-preferences' && method === 'PATCH') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const body = await request.json().catch(() => ({}));
    const provider = String(body.provider || '').trim().toLowerCase();
    if (!STORAGE_PROVIDER_PREFS_ALLOWED.includes(provider)) {
      return jsonResponse({ error: 'Invalid or missing provider' }, 400);
    }
    const uid = String(authUser.id || '').trim();
    let tenantId =
      authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
        ? String(authUser.tenant_id).trim()
        : '';
    if (!tenantId) tenantId = (await fetchAuthUserTenantId(env, uid)) || '';
    if (!tenantId) tenantId = await fallbackSystemTenantId(env);
    const workspaceId =
      body.workspace_id != null && String(body.workspace_id).trim() !== ''
        ? String(body.workspace_id).trim()
        : null;
    const allowedKeysByProvider = {
      r2: ['bucket_name', 'public_base_url', 'r2_prefix'],
      github: ['repo', 'branch', 'base_path'],
      google_drive: ['folder_id', 'folder_name'],
      supabase: ['project_url', 'bucket_name', 'schema'],
      s3: ['endpoint_url', 'access_key_id', 'secret_access_key', 'bucket', 'region'],
    };
    const keys = allowedKeysByProvider[provider] || [];
    let prev = {};
    try {
      const existing = await env.DB.prepare(
        `SELECT preferences_json FROM user_storage_provider_preferences WHERE user_id = ? AND provider = ? LIMIT 1`,
      )
        .bind(uid, provider)
        .first();
      prev = parseJsonSafe(existing?.preferences_json, {});
    } catch (_) {
      prev = {};
    }
    const next = { ...prev };
    for (const k of keys) {
      if (!Object.prototype.hasOwnProperty.call(body, k)) continue;
      const v = body[k];
      if (k === 'secret_access_key' && (v === '' || v === null || v === '********')) continue;
      next[k] = v;
    }
    const preferences_json = JSON.stringify(next);
    try {
      await env.DB.prepare(
        `INSERT INTO user_storage_provider_preferences (user_id, tenant_id, workspace_id, provider, preferences_json, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, provider) DO UPDATE SET
           preferences_json = excluded.preferences_json,
           tenant_id = excluded.tenant_id,
           workspace_id = excluded.workspace_id,
           updated_at = excluded.updated_at`,
      )
        .bind(uid, tenantId, workspaceId, provider, preferences_json)
        .run();
      const row = await env.DB.prepare(
        `SELECT user_id, tenant_id, workspace_id, provider, preferences_json, updated_at
         FROM user_storage_provider_preferences WHERE user_id = ? AND provider = ? LIMIT 1`,
      )
        .bind(uid, provider)
        .first();
      return jsonResponse({ ok: true, preference: maskStorageProviderPrefsRow(row) });
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes('no such table')) {
        return jsonResponse(
          { error: 'user_storage_provider_preferences missing', hint: 'Apply migrations/289_storage_provider_prefs_general_ui.sql' },
          503,
        );
      }
      return jsonResponse({ error: msg }, 500);
    }
  }

  return null;
}

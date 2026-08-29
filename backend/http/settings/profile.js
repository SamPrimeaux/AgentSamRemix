/**
 * Personal account settings APIs: profile, avatar upload, theme, and legacy preferences.
 * - GET   /api/settings/profile
 * - PATCH /api/settings/profile
 * - POST  /api/settings/profile/avatar
 * - GET   /api/settings/theme
 * - GET   /api/settings/preferences
 * Deconstructed from src/api/settings.js (Lane D peel D1, no behavior change).
 */
import { jsonResponse } from '../agentsam/shared.js';
import { fetchAuthUserTenantId } from '../../identity/users/tenant.js';

async function resolveAuthTenantId(env, authUser) {
  if (authUser.tenant_id != null && String(authUser.tenant_id).trim() !== '') {
    return String(authUser.tenant_id).trim();
  }
  let tid = await fetchAuthUserTenantId(env, authUser.id);
  if (tid) return tid;
  if (authUser.email) {
    tid = await fetchAuthUserTenantId(env, authUser.email);
    if (tid) return tid;
  }
  return null;
}

function parseJsonSafe(str, fallback = {}) {
  if (str == null || str === '') return { ...fallback };
  try {
    const o = typeof str === 'string' ? JSON.parse(str) : str;
    return typeof o === 'object' && o !== null ? o : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

export async function handleSettingsProfileRoutes(request, env, ctx, authContext) {
  void ctx;
  const { authUser, pathLower, method, sessionUserId } = authContext || {};
  if (!authUser) return null;

  const isProfilePath =
    pathLower === '/api/settings/profile' ||
    pathLower === '/api/settings/profile/avatar' ||
    pathLower === '/api/settings/theme' ||
    pathLower === '/api/settings/preferences';
  if (!isProfilePath) return null;

  if (pathLower === '/api/settings/profile' && method === 'GET') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const uid = String(authUser.id || '').trim();
    let row = null;
    try {
      row = await env.DB.prepare(
        `SELECT
           u.display_name AS au_display_name,
           u.avatar_url AS au_avatar_url,
           u.phone AS au_phone,
           u.timezone AS au_timezone,
           u.name AS au_name,
           s.full_name,
           s.bio,
           s.primary_email,
           s.backup_email,
           s.phone_verified,
           s.primary_email_verified,
           s.language,
           s.display_name AS us_display_name,
           s.avatar_url AS us_avatar_url,
           s.phone AS us_phone,
           s.timezone AS us_timezone
         FROM auth_users u
         LEFT JOIN user_settings s ON s.user_id = u.id
         WHERE u.id = ?
         LIMIT 1`,
      )
        .bind(uid)
        .first();
    } catch (e) {
      return jsonResponse({ error: e?.message ?? 'profile_load_failed' }, 500);
    }
    const primaryEmail =
      (row?.primary_email != null && String(row.primary_email).trim()) ||
      String(authUser.email || '').trim() ||
      '';
    const displayName =
      (row?.us_display_name != null && String(row.us_display_name).trim()) ||
      (row?.au_display_name != null && String(row.au_display_name).trim()) ||
      String(authUser.display_name || authUser.name || '').trim() ||
      '';
    const avatarUrl =
      (row?.us_avatar_url != null && String(row.us_avatar_url).trim()) ||
      (row?.au_avatar_url != null && String(row.au_avatar_url).trim()) ||
      null;
    const phone =
      (row?.us_phone != null && String(row.us_phone).trim()) ||
      (row?.au_phone != null && String(row.au_phone).trim()) ||
      '';
    const timezone =
      (row?.us_timezone != null && String(row.us_timezone).trim()) ||
      (row?.au_timezone != null && String(row.au_timezone).trim()) ||
      'America/Chicago';
    const language =
      row?.language != null && String(row.language).trim() ? String(row.language).trim() : 'en';
    const worker_base_url =
      typeof env.WORKER_BASE_URL === 'string' ? env.WORKER_BASE_URL.trim() : 'https://inneranimalmedia.com';
    const profile = {
      id: uid,
      email: primaryEmail,
      name: row?.au_name != null ? String(row.au_name) : authUser.name ?? null,
      display_name: displayName,
      full_name: row?.full_name != null ? String(row.full_name) : '',
      avatar_url: avatarUrl,
      phone,
      bio: row?.bio != null ? String(row.bio) : '',
      timezone,
      language,
      primary_email: primaryEmail,
      backup_email: row?.backup_email != null ? String(row.backup_email) : '',
      primary_email_verified: row?.primary_email_verified ? 1 : 0,
      phone_verified: row?.phone_verified ? 1 : 0,
      tenant_id: authUser.tenant_id,
      active_workspace_id: authUser.active_workspace_id,
      worker_base_url,
      flat: {
        display_name: displayName,
        full_name: row?.full_name != null ? String(row.full_name) : displayName,
        primary_email: primaryEmail,
      },
    };
    return jsonResponse(profile);
  }

  if (pathLower === '/api/settings/profile' && method === 'PATCH') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const body = await request.json().catch(() => ({}));
    if (body.primary_email !== undefined) {
      return jsonResponse({ error: 'primary_email is read-only' }, 400);
    }
    const uid = String(authUser.id || '').trim();
    const str = (v, max) => {
      if (v === undefined || v === null) return undefined;
      return String(v).trim().slice(0, max);
    };

    const display_name = str(body.display_name, 200);
    const avatar_url = str(body.avatar_url, 2000);
    const phone = str(body.phone, 64);
    const timezone = str(body.timezone, 80);
    const full_name = str(body.full_name, 200);
    const bio = str(body.bio, 4000);
    const backup_email = str(body.backup_email, 320);
    const language = str(body.language, 16);

    const authSets = [];
    const authVals = [];
    if (display_name !== undefined) {
      authSets.push('display_name = ?');
      authVals.push(display_name || null);
    }
    if (avatar_url !== undefined) {
      authSets.push('avatar_url = ?');
      authVals.push(avatar_url || null);
    }
    if (phone !== undefined) {
      authSets.push('phone = ?');
      authVals.push(phone || null);
    }
    if (timezone !== undefined) {
      authSets.push('timezone = ?');
      authVals.push(timezone || 'America/Chicago');
    }
    if (authSets.length) {
      authVals.push(uid);
      await env.DB.prepare(
        `UPDATE auth_users SET ${authSets.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      )
        .bind(...authVals)
        .run();
    }

    const settingsSets = [];
    const settingsVals = [];
    if (display_name !== undefined) {
      settingsSets.push('display_name = ?');
      settingsVals.push(display_name || null);
    }
    if (avatar_url !== undefined) {
      settingsSets.push('avatar_url = ?');
      settingsVals.push(avatar_url || null);
    }
    if (phone !== undefined) {
      settingsSets.push('phone = ?');
      settingsVals.push(phone || null);
    }
    if (timezone !== undefined) {
      settingsSets.push('timezone = ?');
      settingsVals.push(timezone || 'America/Chicago');
    }
    if (full_name !== undefined) {
      settingsSets.push('full_name = ?');
      settingsVals.push(full_name || null);
    }
    if (bio !== undefined) {
      settingsSets.push('bio = ?');
      settingsVals.push(bio || null);
    }
    if (backup_email !== undefined) {
      settingsSets.push('backup_email = ?');
      settingsVals.push(backup_email || null);
    }
    if (language !== undefined) {
      settingsSets.push('language = ?');
      settingsVals.push(language || 'en');
    }

    if (settingsSets.length) {
      settingsSets.push('updated_at = unixepoch()');
      settingsVals.push(uid);
      const upd = await env.DB.prepare(
        `UPDATE user_settings SET ${settingsSets.join(', ')} WHERE user_id = ?`,
      )
        .bind(...settingsVals)
        .run();
      if (!upd?.meta?.changes) {
        const primary_email = String(authUser.email || '').trim() || null;
        await env.DB.prepare(
          `INSERT INTO user_settings (
             id, user_id, display_name, avatar_url, phone, timezone, full_name, bio,
             backup_email, language, primary_email, theme, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'meaux-storm-gray', unixepoch())`,
        )
          .bind(
            `us_${uid}`,
            uid,
            display_name ?? null,
            avatar_url ?? null,
            phone ?? null,
            timezone ?? 'America/Chicago',
            full_name ?? null,
            bio ?? null,
            backup_email ?? null,
            language ?? 'en',
            primary_email,
          )
          .run();
      }
    }

    if (!authSets.length && !settingsSets.length) {
      return jsonResponse({ error: 'No valid fields' }, 400);
    }
    return jsonResponse({ ok: true });
  }

  if (pathLower === '/api/settings/profile/avatar' && method === 'POST') {
    const ct = (request.headers.get('Content-Type') || '').toLowerCase();
    if (!ct.includes('multipart/form-data')) {
      return jsonResponse({ error: 'multipart file required' }, 400);
    }
    const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
    const token = String(
      env.CLOUDFLARE_IMAGES_TOKEN || env.CLOUDFLARE_IMAGES_API_TOKEN || '',
    ).trim();
    const accountHash = String(env.CLOUDFLARE_IMAGES_ACCOUNT_HASH || '').trim();
    if (!accountId || !token || !accountHash) {
      return jsonResponse({ error: 'Cloudflare Images not configured' }, 503);
    }
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return jsonResponse({ error: 'file required' }, 400);
    }
    const uploadForm = new FormData();
    uploadForm.append('file', file, file.name || 'avatar.jpg');
    let cfJson;
    try {
      const cfRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: uploadForm,
        },
      );
      cfJson = await cfRes.json().catch(() => ({}));
      if (!cfRes.ok || !cfJson?.success) {
        const msg =
          cfJson?.errors?.[0]?.message || cfJson?.messages?.[0]?.message || 'Upload failed';
        return jsonResponse({ error: msg }, cfRes.status >= 400 ? cfRes.status : 502);
      }
    } catch (e) {
      return jsonResponse({ error: e?.message ?? 'Upload failed' }, 502);
    }
    const imageId = cfJson?.result?.id;
    if (!imageId) return jsonResponse({ error: 'No image id returned' }, 502);
    const avatar_url = `https://imagedelivery.net/${accountHash}/${imageId}/avatar`;
    return jsonResponse({ ok: true, avatar_url });
  }

  // ── /api/settings/theme ───────────────────────────────────────────────────
  if (pathLower === '/api/settings/theme' && method === 'GET') {
    if (!env.DB) {
      return jsonResponse({ theme: 'dark', accent_color: '#c8ff3e', dark_mode: true });
    }
    const uid = String(authUser.id || '').trim();
    const defaults = { theme: 'dark', accent_color: '#c8ff3e', dark_mode: true };
    try {
      const row = await env.DB.prepare(
        `SELECT theme, accent_color, dark_mode
         FROM user_settings WHERE user_id = ? LIMIT 1`,
      )
        .bind(uid)
        .first();
      if (!row) return jsonResponse(defaults);
      const theme = row.theme != null && String(row.theme).trim() ? String(row.theme).trim() : defaults.theme;
      const accent_color =
        row.accent_color != null && String(row.accent_color).trim()
          ? String(row.accent_color).trim()
          : defaults.accent_color;
      const dark_mode =
        row.dark_mode === 0 || row.dark_mode === '0' || row.dark_mode === false
          ? false
          : true;
      return jsonResponse({ theme, accent_color, dark_mode });
    } catch (_) {
      return jsonResponse(defaults);
    }
  }

  // ── /api/settings/preferences ─────────────────────────────────────────────
  if (pathLower === '/api/settings/preferences' && method === 'GET') {
    if (!env.DB) return jsonResponse({ prefs_json: {}, tenant_id: null, user_id: sessionUserId });
    const tenantId = await resolveAuthTenantId(env, authUser);
    const uid = String(authUser.id || '').trim();
    if (!tenantId) return jsonResponse({ prefs_json: {}, tenant_id: null, user_id: uid });
    try {
      const row = await env.DB.prepare(
        `SELECT * FROM user_storage_preferences WHERE tenant_id = ? AND user_id = ? LIMIT 1`,
      )
        .bind(tenantId, uid)
        .first();
      if (!row) {
        return jsonResponse({ tenant_id: tenantId, user_id: uid, prefs_json: {}, updated_at: null });
      }
      const prefs = parseJsonSafe(row.prefs_json, {});
      return jsonResponse({ ...row, prefs_json: prefs });
    } catch (_) {
      return jsonResponse({ tenant_id: tenantId, user_id: uid, prefs_json: {}, updated_at: null });
    }
  }

  /** Flat PATCH fields for `/api/settings/user-policy` (dashboard General + agent prefs). */

  return null;
}

export const handleSettingsProfileApi = handleSettingsProfileRoutes;

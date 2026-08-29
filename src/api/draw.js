/**
 * src/api/draw.js
 * Collaborative Drawing & Canvas — Excalidraw scene sync + multi-destination export
 * Destinations: R2 (always), Google Drive (user OAuth), GitHub (user OAuth)
 *
 * Routes:
 *   GET  /api/draw/libraries          — list Excalidraw libraries
 *   GET  /api/draw/library-prefs      — user enabled library slugs
 *   POST /api/draw/library-prefs      — save user enabled library slugs
 *   POST /api/draw/library            — fetch one library by slug (agent + UI)
 *   GET  /api/draw/list               — list user's saved draws
 *   GET  /api/draw/load               — load most recent scene JSON
 *   GET  /api/draw/download/:id       — stream file bytes (R2)
 *   POST /api/draw/save               — save scene JSON or PNG to R2
 *   POST /api/draw/export             — export to R2 + optional GDrive + GitHub
 *   DELETE /api/draw/:id              — delete a draw record + R2 object
 *   GET  /api/draw/connections        — check which exports are connected for user
 */

import { getAuthUser, jsonResponse, fetchAuthUserTenantId, fallbackSystemTenantId } from '../core/auth.js';
import { persistWorkspaceThemeSlug } from '../core/workspace-user-prefs.js';
import { resolveOAuthAccessToken } from './oauth.js';
import {
  broadcastExcalidrawAction,
  persistCollabCanvasElements,
} from '../core/collab-broadcast.js';
import { getIntegrationToken } from '../integrations/tokens.js';
import { platformR2WriteGateResponse } from '../core/r2-storage-scope.js';
import { writeWorkspaceArtifact } from '../core/artifact-r2-store.js';
import { resolveArtifactR2Binding, inferLegacyArtifactBucket } from '../core/artifact-key.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const parts     = dataUrl.split(',');
  if (parts.length < 2) return null;
  const mimeMatch = parts[0].match(/:(.*?);/);
  const contentType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return { bytes: u8arr, contentType };
}

/** PNG/SVG data URL, or raw SVG markup. */
function parseImagePayload(raw, fallbackType = 'application/octet-stream') {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith('data:')) return parseDataUrl(trimmed);
  if (fallbackType === 'image/svg+xml' || /<svg[\s>]/i.test(trimmed)) {
    return { bytes: new TextEncoder().encode(trimmed), contentType: 'image/svg+xml' };
  }
  return null;
}

function safeFilename(name = '') {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || `draw_${Date.now()}`;
}

/** Resolve R2 binding for project_draws keys (new ARTIFACTS `user/…` vs legacy ASSETS `draw/…`). */
function resolveDrawStorageBinding(env, r2Key) {
  const bucketName = inferLegacyArtifactBucket(r2Key);
  return resolveArtifactR2Binding(env, bucketName) || env.ASSETS || null;
}

async function resolveDrawExportIdentity(env, authUser, body = {}) {
  const userId = String(authUser.id || authUser.user_id || authUser.userId || '').trim();
  const workspaceId = String(
    body.workspace_id ||
      body.workspaceId ||
      authUser.active_workspace_id ||
      authUser.workspace_id ||
      authUser.workspaceId ||
      '',
  ).trim();
  let tenantId =
    authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
      ? String(authUser.tenant_id).trim()
      : await fetchAuthUserTenantId(env, userId);
  if (!tenantId && authUser.email) tenantId = await fetchAuthUserTenantId(env, authUser.email);
  if (!tenantId) tenantId = fallbackSystemTenantId(env);
  return { userId, workspaceId, tenantId: String(tenantId || '').trim() };
}

import { normalizeExcalidrawLibraryPayload } from '../core/excalidraw-library-normalize.js';

function parseExcalidrawLibraryPayload(raw, slug = '') {
  return normalizeExcalidrawLibraryPayload(raw, { slug, itemNamePrefix: slug || undefined });
}

async function fetchLibraryJsonFromRow(env, row) {
  const url = String(row.public_url || row.r2_dev_url || '').trim();
  if (url) {
    const res = await fetch(url, { cf: { cacheTtl: 3600 } });
    if (res.ok) {
      try {
        return parseExcalidrawLibraryPayload(await res.json(), String(row.slug || ''));
      } catch {
        /* fall through to R2 */
      }
    }
  }
  const bucket = String(row.r2_bucket || 'agent-sam').trim();
  const key = String(row.r2_key || '').trim();
  if (!key) return [];
  const binding = bucket === 'inneranimalmedia' ? env.ASSETS : env.TOOLS || env.ASSETS;
  if (!binding?.get) return [];
  const obj = await binding.get(key);
  if (!obj) return [];
  try {
    return parseExcalidrawLibraryPayload(await obj.json(), String(row.slug || ''));
  } catch {
    return [];
  }
}

// Google Drive OAuth refresh: getIntegrationToken → getIntegrationOAuthRow reads
// access_token_encrypted / refresh_token_encrypted, calls oauth2.googleapis.com/token
// with grant_type=refresh_token, and persists to D1 when expired.

// ── Token lookup ──────────────────────────────────────────────────────────────

async function getUserOAuthToken(env, userId, provider) {
  return getIntegrationToken(env, userId, provider, '');
}

// ── Google Drive export ───────────────────────────────────────────────────────

async function exportToGDrive(env, userId, { bytes, contentType, filename, existingFileId }) {
  const token = await getUserOAuthToken(env, userId, 'google_drive');
  const bearer = await resolveOAuthAccessToken(env, token);
  if (!bearer) {
    return { ok: false, error: 'Google Drive not connected. Connect it in Settings → Integrations.' };
  }

  const meta     = JSON.stringify({ name: filename, mimeType: contentType });
  const boundary = '-------IAMDrawBoundary';
  const body     = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
    `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
  ];

  // Build multipart body manually (Workers don't have FormData binary support)
  const enc     = new TextEncoder();
  const part1   = enc.encode(body[0]);
  const part2   = enc.encode(body[1]);
  const closing = enc.encode(`\r\n--${boundary}--`);
  const merged  = new Uint8Array(part1.length + part2.length + bytes.length + closing.length);
  merged.set(part1, 0);
  merged.set(part2, part1.length);
  merged.set(bytes, part1.length + part2.length);
  merged.set(closing, part1.length + part2.length + bytes.length);

  // Create new or update existing
  const isUpdate = !!existingFileId;
  const url = isUpdate
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

  const res = await fetch(url, {
    method:  isUpdate ? 'PATCH' : 'POST',
    headers: {
      'Authorization':  `Bearer ${bearer}`,
      'Content-Type':   `multipart/related; boundary="${boundary}"`,
      'Content-Length': String(merged.length),
    },
    body: merged,
  });

  if (!res.ok) {
    const err = await res.text();
    // 401 = token expired
    if (res.status === 401) {
      return { ok: false, error: 'Google Drive token expired. Re-connect in Settings → Integrations.' };
    }
    return { ok: false, error: `Google Drive API error ${res.status}: ${err}` };
  }

  const data = await res.json();
  return {
    ok:        true,
    fileId:    data.id,
    fileName:  data.name,
    webViewLink: `https://drive.google.com/file/d/${data.id}/view`,
  };
}

// ── GitHub export ─────────────────────────────────────────────────────────────

async function exportToGitHub(env, userId, { bytes, filename, repo, path, existingSha, commitMessage }) {
  const token = await getUserOAuthToken(env, userId, 'github');
  const bearer = await resolveOAuthAccessToken(env, token);
  if (!bearer) {
    return { ok: false, error: 'GitHub not connected. Connect it in Settings → Integrations.' };
  }

  if (!repo) {
    return { ok: false, error: 'GitHub repo required (format: owner/repo).' };
  }

  const filePath  = path ? `${path.replace(/\/$/, '')}/${filename}` : `excalidraw/${filename}`;
  const b64Content = btoa(String.fromCharCode(...bytes));
  const message   = commitMessage || `[IAM] Update ${filename}`;

  const body = { message, content: b64Content };
  if (existingSha) body.sha = existingSha; // required for updates

  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${bearer}`,
      'Content-Type':  'application/json',
      'Accept':        'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 401) {
      return { ok: false, error: 'GitHub token expired or revoked. Re-connect in Settings → Integrations.' };
    }
    if (res.status === 422) {
      return { ok: false, error: 'File already exists on GitHub. Provide the existing SHA to update.' };
    }
    return { ok: false, error: `GitHub API error ${res.status}: ${err.message || JSON.stringify(err)}` };
  }

  const data = await res.json();
  return {
    ok:      true,
    sha:     data.content?.sha,
    htmlUrl: data.content?.html_url,
    path:    data.content?.path,
    repo,
  };
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

export async function handleDrawApi(request, url, env, ctx) {
  const pathLower = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method    = request.method.toUpperCase();

  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

  if (!env.DB)        return jsonResponse({ error: 'DB not configured' }, 503);
  if (!env.ASSETS) return jsonResponse({ error: 'DASHBOARD bucket not configured' }, 503);

  const userId = authUser.id || authUser.user_id || authUser.userId;

  try {
    // ── POST /api/canvas/theme ────────────────────────────────────────────────
    if (pathLower === '/api/canvas/theme' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const workspace_id = String(body.workspace_id || '').trim();
      const theme_slug = String(body.theme_slug || '').trim();
      if (!workspace_id) return jsonResponse({ error: 'workspace_id required' }, 400);
      if (!theme_slug) return jsonResponse({ error: 'theme_slug required' }, 400);

      await persistWorkspaceThemeSlug(env, workspace_id, theme_slug);
      return jsonResponse({ ok: true, workspace_id, theme_slug });
    }

    // ── GET /api/draw/libraries ───────────────────────────────────────────────
    if (pathLower === '/api/draw/libraries' && method === 'GET') {
      const { results } = await env.DB.prepare(`
        SELECT slug, name, filename, category, icon, public_url, r2_dev_url,
               auto_load, agent_tags, description, item_count
        FROM draw_libraries WHERE is_active = 1
        ORDER BY category ASC, sort_order ASC, name ASC
      `).all();
      return jsonResponse({ libraries: results || [] });
    }

    // ── GET /api/draw/library-prefs ───────────────────────────────────────────
    if (pathLower === '/api/draw/library-prefs' && method === 'GET') {
      const { results } = await env.DB.prepare(`
        SELECT lib_slug AS slug, is_enabled AS enabled, is_pinned AS pinned
        FROM user_draw_library_prefs
        WHERE user_id = ?
        ORDER BY is_pinned DESC, lib_slug ASC
      `).bind(userId).all();
      const prefs = (results || []).map((r) => ({
        slug: String(r.slug || ''),
        enabled: Number(r.enabled) === 1,
        pinned: Number(r.pinned) === 1,
      }));
      return jsonResponse({ prefs });
    }

    // ── POST /api/draw/library-prefs ──────────────────────────────────────────
    if (pathLower === '/api/draw/library-prefs' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const slugs = Array.isArray(body.enabled_slugs)
        ? body.enabled_slugs.map((s) => String(s || '').trim()).filter(Boolean)
        : [];
      const tenantId = String(authUser.tenant_id || '').trim();
      if (!tenantId) return jsonResponse({ error: 'tenant_id_required' }, 400);
      await env.DB.prepare(`DELETE FROM user_draw_library_prefs WHERE user_id = ?`).bind(userId).run();
      for (const slug of slugs) {
        await env.DB.prepare(`
          INSERT INTO user_draw_library_prefs (user_id, tenant_id, lib_slug, is_enabled, is_pinned, updated_at)
          VALUES (?, ?, ?, 1, 0, unixepoch())
        `).bind(userId, tenantId, slug).run();
      }
      return jsonResponse({ ok: true, enabled_slugs: slugs });
    }

    // ── POST /api/draw/library ────────────────────────────────────────────────
    if (pathLower === '/api/draw/library' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const slug = String(body.slug || body.library_slug || '').trim();
      if (!slug) return jsonResponse({ error: 'slug required' }, 400);
      const row = await env.DB.prepare(`
        SELECT slug, name, public_url, r2_dev_url, r2_bucket, r2_key
        FROM draw_libraries
        WHERE slug = ? AND is_active = 1
        LIMIT 1
      `).bind(slug).first();
      if (!row) return jsonResponse({ error: 'library not found' }, 404);
      const libraryItems = await fetchLibraryJsonFromRow(env, row);
      return jsonResponse({ ok: true, slug, name: row.name, libraryItems });
    }

    // ── GET /api/draw/list ────────────────────────────────────────────────────
    if (pathLower === '/api/draw/list' && method === 'GET') {
      const projectId = (url.searchParams.get('project_id') || userId).trim();
      const { results } = await env.DB.prepare(`
        SELECT id, project_id, user_id, title, filename, r2_key, generation_type,
               exports_json, gdrive_file_id, github_repo, github_path, github_sha,
               created_at
        FROM project_draws
        WHERE project_id = ? OR user_id = ?
        ORDER BY created_at DESC LIMIT 100
      `).bind(projectId, userId).all();
      return jsonResponse({ draws: results || [] });
    }

    // ── GET /api/draw/load ────────────────────────────────────────────────────
    if (pathLower === '/api/draw/load' && method === 'GET') {
      const sceneRow = await env.DB.prepare(`
        SELECT r2_key FROM project_draws
        WHERE (project_id = ? OR user_id = ?) AND generation_type = 'json_scene'
        ORDER BY created_at DESC LIMIT 1
      `).bind(userId, userId).first();

      if (!sceneRow) return jsonResponse({ scene: null });
      const sceneBinding = resolveDrawStorageBinding(env, sceneRow.r2_key);
      const obj = sceneBinding?.get ? await sceneBinding.get(sceneRow.r2_key) : null;
      if (!obj) return jsonResponse({ scene: null });
      try {
        return jsonResponse({ scene: JSON.parse(await obj.text()), r2_key: sceneRow.r2_key });
      } catch { return jsonResponse({ scene: null }); }
    }

    // ── GET /api/draw/download/:id ────────────────────────────────────────────
    if (pathLower.startsWith('/api/draw/download/') && method === 'GET') {
      const id  = pathLower.replace('/api/draw/download/', '');
      const row = await env.DB.prepare(`
        SELECT r2_key, filename, generation_type FROM project_draws
        WHERE id = ? AND (project_id = ? OR user_id = ?)
      `).bind(id, userId, userId).first();

      if (!row) return jsonResponse({ error: 'Not found' }, 404);
      const dlBinding = resolveDrawStorageBinding(env, row.r2_key);
      const obj = dlBinding?.get ? await dlBinding.get(row.r2_key) : null;
      if (!obj) return jsonResponse({ error: 'File not found in storage' }, 404);

      const contentType =
        row.generation_type === 'png_export' || row.generation_type === 'plan_export'
          ? 'image/png'
          : row.generation_type === 'svg_export'
            ? 'image/svg+xml'
            : 'application/json';
      const disposition = `attachment; filename="${row.filename || 'drawing'}"`;
      return new Response(obj.body, {
        headers: {
          'Content-Type':        contentType,
          'Content-Disposition': disposition,
          'Cache-Control':       'private, max-age=3600',
        },
      });
    }

    // ── GET /api/draw/connections ─────────────────────────────────────────────
    if (pathLower === '/api/draw/connections' && method === 'GET') {
      const [gdrive, github] = await Promise.all([
        getUserOAuthToken(env, userId, 'google_drive'),
        getUserOAuthToken(env, userId, 'github'),
      ]);
      return jsonResponse({
        google_drive: !!gdrive?.access_token,
        github:       !!github?.access_token,
      });
    }

    // ── POST /api/draw/save ───────────────────────────────────────────────────
    if (pathLower === '/api/draw/save' && method === 'POST') {
      const r2Denied = platformR2WriteGateResponse(authUser);
      if (r2Denied) return r2Denied;

      const body     = await request.json().catch(() => ({}));
      const title    = (body.title || '').trim() || `Drawing ${new Date().toLocaleDateString()}`;
      const filename = safeFilename(body.filename || title);

      // Scene JSON save
      if (body.scene && typeof body.scene === 'object') {
        const r2Key = `draw/scenes/${userId}/${crypto.randomUUID()}.json`;
        await env.ASSETS.put(r2Key, JSON.stringify(body.scene), {
          httpMetadata: { contentType: 'application/json' },
        });
        const ins = await env.DB.prepare(`
          INSERT INTO project_draws (project_id, user_id, title, filename, r2_key, generation_type, created_at)
          VALUES (?, ?, ?, ?, ?, 'json_scene', datetime('now'))
        `).bind(userId, userId, title, `${filename}.excalidraw`, r2Key).run();
        return jsonResponse({ ok: true, id: ins?.meta?.last_row_id, r2_key: r2Key });
      }

      // PNG export save
      if (body.canvasData && typeof body.canvasData === 'string') {
        const parsed = parseDataUrl(body.canvasData);
        if (!parsed) return jsonResponse({ error: 'Invalid canvasData' }, 400);
        const r2Key = `draw/exports/${userId}/${crypto.randomUUID()}.png`;
        await env.ASSETS.put(r2Key, parsed.bytes, {
          httpMetadata: { contentType: parsed.contentType },
        });
        const ins = await env.DB.prepare(`
          INSERT INTO project_draws (project_id, user_id, title, filename, r2_key, generation_type, created_at)
          VALUES (?, ?, ?, ?, ?, 'png_export', datetime('now'))
        `).bind(userId, userId, title, `${filename}.png`, r2Key).run();
        return jsonResponse({ ok: true, id: ins?.meta?.last_row_id, r2_key: r2Key });
      }

      return jsonResponse({ error: 'scene or canvasData required' }, 400);
    }

    // ── POST /api/draw/export ─────────────────────────────────────────────────
    //
    // Body:
    //   canvasData    string  — PNG data URL (required unless svgData only)
    //   svgData       string  — SVG data URL or raw <svg> markup (optional)
    //   scene         object  — Excalidraw JSON — optional, saved alongside
    //   title         string  — human name
    //   filename      string  — base filename (no extension)
    //   destinations  array   — ['r2', 'gdrive', 'github'] — defaults to ['r2']
    //   drawId        number  — existing draw ID to update
    //   blueprint_id  string  — optional Design Studio blueprint to attach previews
    //   gdrive        object  — { fileId? }
    //   github        object  — { repo, path?, sha?, commitMessage? }
    //
    if (pathLower === '/api/draw/export' && method === 'POST') {
      const r2Denied = platformR2WriteGateResponse(authUser);
      if (r2Denied) return r2Denied;

      const body         = await request.json().catch(() => ({}));
      const title        = (body.title || '').trim() || `Export ${new Date().toLocaleDateString()}`;
      const baseName     = safeFilename(body.filename || title);
      const destinations = Array.isArray(body.destinations) ? body.destinations : ['r2'];
      const blueprintId  = body.blueprint_id != null ? String(body.blueprint_id).trim() : '';

      const identity = await resolveDrawExportIdentity(env, authUser, body);
      if (!identity.workspaceId) {
        return jsonResponse({ error: 'workspace_id required' }, 400);
      }
      if (!identity.tenantId) {
        return jsonResponse({ error: 'tenant_id required' }, 400);
      }
      if (!env.ARTIFACTS?.put) {
        return jsonResponse({ error: 'ARTIFACTS bucket not configured' }, 503);
      }

      const pngParsed = body.canvasData ? parseImagePayload(body.canvasData, 'image/png') : null;
      const svgParsed = body.svgData ? parseImagePayload(body.svgData, 'image/svg+xml') : null;
      if (!pngParsed && !svgParsed) {
        return jsonResponse({ error: 'canvasData (PNG) and/or svgData required' }, 400);
      }
      if (body.canvasData && !pngParsed) return jsonResponse({ error: 'Invalid canvasData' }, 400);
      if (body.svgData && !svgParsed) return jsonResponse({ error: 'Invalid svgData' }, 400);

      const pngFilename = `${baseName}.png`;
      const svgFilename = `${baseName}.svg`;
      const generationType = pngParsed && svgParsed ? 'plan_export' : pngParsed ? 'png_export' : 'svg_export';
      const results = {};
      const origin = (() => {
        try {
          return new URL(request.url).origin;
        } catch {
          return env?.IAM_ORIGIN != null ? String(env.IAM_ORIGIN).trim() : '';
        }
      })();

      let r2Key = null;
      let publicUrl = '';
      let artifactId = null;
      let svgR2Key = null;
      let svgPublicUrl = '';
      let svgArtifactId = null;
      let sceneR2Key = null;
      let sceneArtifactId = null;
      let scenePublicUrl = '';

      const artifactBase = {
        userId: identity.userId || userId,
        workspaceId: identity.workspaceId,
        tenantId: identity.tenantId,
        kind: 'export',
        source: 'draw_export',
        origin: origin || null,
        authUser,
      };

      // ── 1. ARTIFACTS PNG (primary preview) ──
      if (pngParsed) {
        const out = await writeWorkspaceArtifact(env, ctx, {
          ...artifactBase,
          contentBytes: pngParsed.bytes,
          contentType: 'image/png',
          artifactType: 'image',
          name: pngFilename,
          description: title,
          metadata: { generation_type: generationType, format: 'png' },
        });
        if (!out.ok) {
          return jsonResponse({ error: out.error || 'png_artifact_write_failed', detail: out.user_message }, 500);
        }
        r2Key = out.r2_key;
        publicUrl = out.public_url;
        artifactId = out.artifact_id;
        results.r2 = {
          ok: true,
          r2_key: r2Key,
          public_url: publicUrl,
          artifact_id: artifactId,
          content_type: 'image/png',
          r2_bucket: 'artifacts',
        };
      }

      // ── 1b. ARTIFACTS SVG (vector plan) ──
      if (svgParsed) {
        const out = await writeWorkspaceArtifact(env, ctx, {
          ...artifactBase,
          contentBytes: svgParsed.bytes,
          contentType: 'image/svg+xml',
          artifactType: 'svg',
          name: svgFilename,
          description: title,
          metadata: { generation_type: generationType, format: 'svg' },
        });
        if (!out.ok) {
          return jsonResponse({ error: out.error || 'svg_artifact_write_failed', detail: out.user_message }, 500);
        }
        svgR2Key = out.r2_key;
        svgPublicUrl = out.public_url;
        svgArtifactId = out.artifact_id;
        results.r2_svg = {
          ok: true,
          r2_key: svgR2Key,
          public_url: svgPublicUrl,
          artifact_id: svgArtifactId,
          content_type: 'image/svg+xml',
          r2_bucket: 'artifacts',
        };
        if (!results.r2) {
          results.r2 = { ...results.r2_svg };
          r2Key = svgR2Key;
          publicUrl = svgPublicUrl;
          artifactId = svgArtifactId;
        }
      }

      // Also save scene JSON if provided
      if (body.scene && typeof body.scene === 'object') {
        const sceneName = `${baseName}.excalidraw`;
        const out = await writeWorkspaceArtifact(env, ctx, {
          ...artifactBase,
          content: JSON.stringify(body.scene),
          contentType: 'application/json',
          artifactType: 'excalidraw',
          name: sceneName,
          description: title,
          metadata: { generation_type: 'json_scene', format: 'excalidraw' },
        });
        if (!out.ok) {
          return jsonResponse({ error: out.error || 'scene_artifact_write_failed', detail: out.user_message }, 500);
        }
        sceneR2Key = out.r2_key;
        sceneArtifactId = out.artifact_id;
        scenePublicUrl = out.public_url;
        results.scene = {
          ok: true,
          r2_key: sceneR2Key,
          public_url: scenePublicUrl,
          artifact_id: sceneArtifactId,
          r2_bucket: 'artifacts',
        };
      }

      // ── 2. Google Drive (optional — PNG preferred) ──
      let gdriveFileId = body.gdrive?.fileId || null;
      if (destinations.includes('gdrive') && pngParsed) {
        const gd = await exportToGDrive(env, userId, {
          bytes:          pngParsed.bytes,
          contentType:    'image/png',
          filename:       pngFilename,
          existingFileId: gdriveFileId,
        });
        results.gdrive = gd;
        if (gd.ok) gdriveFileId = gd.fileId;
      }

      // ── 3. GitHub (optional — PNG preferred) ──
      let githubSha  = body.github?.sha  || null;
      let githubRepo = body.github?.repo || null;
      let githubPath = null;
      if (destinations.includes('github') && body.github?.repo && pngParsed) {
        const gh = await exportToGitHub(env, userId, {
          bytes:         pngParsed.bytes,
          filename:      pngFilename,
          repo:          body.github.repo,
          path:          body.github.path || 'excalidraw',
          existingSha:   githubSha,
          commitMessage: body.github.commitMessage,
        });
        results.github = gh;
        if (gh.ok) { githubSha = gh.sha; githubPath = gh.path; githubRepo = gh.repo; }
      }

      // ── Persist to D1 ──
      const exportsJson = JSON.stringify(results);
      let drawId = body.drawId || null;
      const primaryFilename = pngParsed ? pngFilename : svgFilename;

      if (drawId) {
        await env.DB.prepare(`
          UPDATE project_draws SET
            title = ?, filename = ?, r2_key = ?, generation_type = ?,
            exports_json = ?, gdrive_file_id = ?, github_repo = ?,
            github_path = ?, github_sha = ?
          WHERE id = ? AND (project_id = ? OR user_id = ?)
        `).bind(
          title, primaryFilename, r2Key, generationType, exportsJson,
          gdriveFileId, githubRepo, githubPath, githubSha,
          drawId, userId, userId
        ).run();
      } else {
        const ins = await env.DB.prepare(`
          INSERT INTO project_draws
            (project_id, user_id, title, filename, r2_key, generation_type,
             exports_json, gdrive_file_id, github_repo, github_path, github_sha, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).bind(
          userId, userId, title, primaryFilename, r2Key, generationType, exportsJson,
          gdriveFileId, githubRepo, githubPath, githubSha
        ).run();
        drawId = ins?.meta?.last_row_id;
      }

      if (svgR2Key && pngParsed) {
        await env.DB.prepare(`
          INSERT INTO project_draws
            (project_id, user_id, title, filename, r2_key, generation_type, created_at)
          VALUES (?, ?, ?, ?, ?, 'svg_export', datetime('now'))
        `).bind(userId, userId, title, svgFilename, svgR2Key).run();
      }

      if (sceneR2Key) {
        await env.DB.prepare(`
          INSERT INTO project_draws
            (project_id, user_id, title, filename, r2_key, generation_type, created_at)
          VALUES (?, ?, ?, ?, ?, 'json_scene', datetime('now'))
        `).bind(userId, userId, title, `${baseName}.excalidraw`, sceneR2Key).run();
      }

      // ── Attach previews to Design Studio blueprint (optional) ──
      let blueprint = null;
      if (blueprintId) {
        try {
          const tenantId = identity.tenantId;

          const existing = await env.DB.prepare(
            `SELECT id FROM designstudio_design_blueprints WHERE id = ? AND tenant_id = ?`,
          )
            .bind(blueprintId, tenantId)
            .first();
          if (existing) {
            const sets = [];
            const vals = [];
            const push = (col, v) => {
              sets.push(`${col} = ?`);
              vals.push(v);
            };
            if (publicUrl) push('preview_image_url', publicUrl);
            if (svgPublicUrl) push('preview_svg_url', svgPublicUrl);
            if (body.scene && typeof body.scene === 'object') {
              push('sketch_json', JSON.stringify(body.scene));
            }
            if (sets.length) {
              sets.push(`updated_at = datetime('now')`);
              vals.push(blueprintId, tenantId);
              await env.DB.prepare(
                `UPDATE designstudio_design_blueprints SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`,
              )
                .bind(...vals)
                .run();
              results.blueprint = { ok: true, id: blueprintId };
            }
            blueprint = await env.DB.prepare(`SELECT * FROM designstudio_design_blueprints WHERE id = ?`)
              .bind(blueprintId)
              .first();
          } else {
            results.blueprint = { ok: false, error: 'Blueprint not found' };
          }
        } catch (bpErr) {
          results.blueprint = { ok: false, error: String(bpErr?.message || bpErr) };
        }
      }

      return jsonResponse({
        ok: true,
        drawId,
        r2_key: r2Key,
        public_url: publicUrl || null,
        artifact_id: artifactId,
        svg_r2_key: svgR2Key,
        svg_public_url: svgPublicUrl || null,
        svg_artifact_id: svgArtifactId,
        scene_r2_key: sceneR2Key,
        scene_public_url: scenePublicUrl || null,
        scene_artifact_id: sceneArtifactId,
        generation_type: generationType,
        blueprint_id: blueprintId || null,
        blueprint,
        results,
        exported: Object.entries(results)
          .filter(([, v]) => v?.ok)
          .map(([k]) => k),
        errors: Object.entries(results)
          .filter(([, v]) => !v?.ok)
          .reduce((acc, [k, v]) => ({ ...acc, [k]: v.error }), {}),
      });
    }

    // ── POST /api/draw/elements — IAM_COLLAB fanout for agent/dashboard Excalidraw sync ─
    if (pathLower === '/api/draw/elements' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const workspaceId = String(
        body.workspace_id || url.searchParams.get('workspace_id') || '',
      ).trim();
      if (!workspaceId) return jsonResponse({ error: 'workspace_id required' }, 400);
      const elements = Array.isArray(body.elements) ? body.elements : [];
      await broadcastExcalidrawAction(env, workspaceId, 'add_elements', { elements });
      if (body.replace_scene === true && elements.length > 0) {
        await persistCollabCanvasElements(env, workspaceId, elements);
      }
      return jsonResponse({ ok: true, element_count: elements.length });
    }

    // ── POST /api/draw/clear — IAM_COLLAB fanout for Excalidraw clear ─────────
    if (pathLower === '/api/draw/clear' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const workspaceId = String(
        body.workspace_id || url.searchParams.get('workspace_id') || '',
      ).trim();
      if (!workspaceId) return jsonResponse({ error: 'workspace_id required' }, 400);
      await broadcastExcalidrawAction(env, workspaceId, 'clear', {});
      return jsonResponse({ ok: true });
    }

    // ── DELETE /api/draw/:id ──────────────────────────────────────────────────
    if (pathLower.startsWith('/api/draw/') && method === 'DELETE') {
      const id  = pathLower.replace('/api/draw/', '');
      const row = await env.DB.prepare(`
        SELECT r2_key FROM project_draws WHERE id = ? AND (project_id = ? OR user_id = ?)
      `).bind(id, userId, userId).first();

      if (!row) return jsonResponse({ error: 'Not found or not yours' }, 404);

      const delBinding = resolveDrawStorageBinding(env, row.r2_key);
      await Promise.all([
        delBinding?.delete ? delBinding.delete(row.r2_key).catch(() => {}) : Promise.resolve(),
        env.DB.prepare(`DELETE FROM project_draws WHERE id = ?`).bind(id).run(),
      ]);
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: 'Draw route not found' }, 404);

  } catch (e) {
    return jsonResponse({ error: String(e?.message || e) }, 500);
  }
}

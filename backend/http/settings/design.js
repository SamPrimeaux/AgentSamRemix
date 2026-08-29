/**
 * Workspace Brand & Design settings.
 *
 * Source of truth: workspaces.settings_json.design_profile.
 * Binary references live in the ASSETS R2 binding; settings_json stores metadata only.
 *
 * - GET    /api/settings/design
 * - PATCH  /api/settings/design
 * - POST   /api/settings/design/assets
 * - GET    /api/settings/design/assets/:asset_id
 * - DELETE /api/settings/design/assets/:asset_id
 */
import { jsonResponse } from '../agentsam/shared.js';
import { userCanAccessWorkspace } from '../../identity/workspace/access.js';

const MAX_TEXT = 12_000;
const MAX_NAME = 160;
const MAX_REFS = 24;
const MAX_ASSETS = 100;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function text(value, max = MAX_TEXT) {
  return String(value ?? '').trim().slice(0, max);
}

function parseObject(value) {
  if (!value) return {};
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function cleanRefs(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const ref = text(raw, 1000);
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    out.push(ref);
    if (out.length >= MAX_REFS) break;
  }
  return out;
}

function cleanAsset(row) {
  if (!row || typeof row !== 'object') return null;
  const id = text(row.id, 120);
  const r2Key = text(row.r2_key, 1200);
  if (!id || !r2Key) return null;
  return {
    id,
    kind: text(row.kind, 40) || 'brand_asset',
    name: text(row.name, 240) || 'asset',
    content_type: text(row.content_type, 160) || 'application/octet-stream',
    size: Math.max(0, Number(row.size) || 0),
    r2_key: r2Key,
    created_at: Math.max(0, Number(row.created_at) || 0),
  };
}

function normalizeProfile(value) {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const assets = Array.isArray(row.assets)
    ? row.assets.map(cleanAsset).filter(Boolean).slice(0, MAX_ASSETS)
    : [];
  return {
    name: text(row.name, MAX_NAME),
    blurb: text(row.blurb),
    notes: text(row.notes),
    github_references: cleanRefs(row.github_references),
    assets,
  };
}

function mergeProfile(current, patch) {
  const base = normalizeProfile(current);
  const input = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  return normalizeProfile({
    ...base,
    ...(Object.prototype.hasOwnProperty.call(input, 'name') ? { name: input.name } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'blurb') ? { blurb: input.blurb } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'notes') ? { notes: input.notes } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'github_references')
      ? { github_references: input.github_references }
      : {}),
    assets: base.assets,
  });
}

function assetDownloadPath(assetId) {
  return `/api/settings/design/assets/${encodeURIComponent(assetId)}`;
}

function publicProfile(profile) {
  const normalized = normalizeProfile(profile);
  return {
    ...normalized,
    assets: normalized.assets.map((asset) => ({
      ...asset,
      download_url: assetDownloadPath(asset.id),
    })),
  };
}

function safeFilename(name) {
  return text(name, 180).replace(/[^a-zA-Z0-9._()+ -]+/g, '_') || 'asset';
}

async function resolveWorkspaceId(env, authContext, explicitWorkspaceId = '') {
  const requested = text(explicitWorkspaceId, 180);
  const identityWorkspace = text(authContext?.identity?.workspace?.id, 180);
  const workspaceId = requested || identityWorkspace;
  if (!workspaceId) return { error: jsonResponse({ error: 'workspace_id required' }, 400) };
  if (!(await userCanAccessWorkspace(env, authContext?.authUser, workspaceId))) {
    return { error: jsonResponse({ error: 'Forbidden' }, 403) };
  }
  return { workspaceId };
}

async function loadSettingsRoot(env, workspaceId) {
  const row = await env.DB.prepare(`SELECT settings_json FROM workspaces WHERE id = ? LIMIT 1`)
    .bind(workspaceId)
    .first();
  if (!row) return null;
  return parseObject(row.settings_json);
}

async function saveProfile(env, workspaceId, root, profile) {
  const nextRoot = { ...root, design_profile: normalizeProfile(profile) };
  await env.DB.prepare(
    `UPDATE workspaces SET settings_json = ?, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(JSON.stringify(nextRoot), workspaceId)
    .run();
  return nextRoot.design_profile;
}

function assetIdFromPath(pathLower) {
  const prefix = '/api/settings/design/assets/';
  if (!pathLower.startsWith(prefix)) return '';
  const tail = pathLower.slice(prefix.length);
  if (!tail || tail.includes('/')) return '';
  try {
    return decodeURIComponent(tail).trim();
  } catch {
    return tail.trim();
  }
}

export async function handleSettingsDesignRoutes(request, env, ctx, authContext) {
  void ctx;
  const { url, pathLower, method } = authContext || {};
  if (!pathLower?.startsWith('/api/settings/design')) return null;
  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);

  const isRoot = pathLower === '/api/settings/design';
  const isAssets = pathLower === '/api/settings/design/assets';
  const assetId = assetIdFromPath(pathLower);
  if (!isRoot && !isAssets && !assetId) return null;

  if (isRoot && method === 'GET') {
    const resolved = await resolveWorkspaceId(env, authContext, url?.searchParams?.get('workspace_id'));
    if (resolved.error) return resolved.error;
    const root = await loadSettingsRoot(env, resolved.workspaceId);
    if (!root) return jsonResponse({ error: 'Workspace not found' }, 404);
    return jsonResponse({
      ok: true,
      workspace_id: resolved.workspaceId,
      design_profile: publicProfile(root.design_profile),
    });
  }

  if (isRoot && method === 'PATCH') {
    const body = await request.json().catch(() => ({}));
    const resolved = await resolveWorkspaceId(env, authContext, body.workspace_id);
    if (resolved.error) return resolved.error;
    const root = await loadSettingsRoot(env, resolved.workspaceId);
    if (!root) return jsonResponse({ error: 'Workspace not found' }, 404);
    if (!body.design_profile || typeof body.design_profile !== 'object' || Array.isArray(body.design_profile)) {
      return jsonResponse({ error: 'design_profile object required' }, 400);
    }
    const profile = mergeProfile(root.design_profile, body.design_profile);
    await saveProfile(env, resolved.workspaceId, root, profile);
    return jsonResponse({
      ok: true,
      workspace_id: resolved.workspaceId,
      design_profile: publicProfile(profile),
    });
  }

  if (isAssets && method === 'POST') {
    if (!env.ASSETS?.put) return jsonResponse({ error: 'ASSETS storage not configured' }, 503);
    const contentType = String(request.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('multipart/form-data')) {
      return jsonResponse({ error: 'multipart/form-data required' }, 400);
    }
    const form = await request.formData().catch(() => null);
    if (!form) return jsonResponse({ error: 'invalid multipart body' }, 400);
    const file = form.get('file');
    if (!file || typeof file === 'string') return jsonResponse({ error: 'file required' }, 400);
    if (Number(file.size || 0) <= 0) return jsonResponse({ error: 'empty file' }, 400);
    if (Number(file.size || 0) > MAX_UPLOAD_BYTES) {
      return jsonResponse({ error: 'file_too_large', max_bytes: MAX_UPLOAD_BYTES }, 413);
    }

    const resolved = await resolveWorkspaceId(env, authContext, form.get('workspace_id'));
    if (resolved.error) return resolved.error;
    const root = await loadSettingsRoot(env, resolved.workspaceId);
    if (!root) return jsonResponse({ error: 'Workspace not found' }, 404);

    const current = normalizeProfile(root.design_profile);
    if (current.assets.length >= MAX_ASSETS) {
      return jsonResponse({ error: 'design_asset_limit_reached', max_assets: MAX_ASSETS }, 409);
    }

    const id = crypto.randomUUID();
    const name = safeFilename(file.name || 'asset');
    const requestedKind = text(form.get('kind'), 40);
    const kind = requestedKind === 'figma' ? 'figma' : 'brand_asset';
    const r2Key = `workspaces/${resolved.workspaceId}/design/${id}/${name}`;
    const type = text(file.type, 160) || 'application/octet-stream';

    await env.ASSETS.put(r2Key, file.stream(), {
      httpMetadata: { contentType: type },
      customMetadata: {
        workspace_id: resolved.workspaceId,
        purpose: 'design_profile',
        kind,
        filename: name,
      },
    });

    const asset = {
      id,
      kind,
      name,
      content_type: type,
      size: Number(file.size || 0),
      r2_key: r2Key,
      created_at: Date.now(),
    };
    const profile = { ...current, assets: [...current.assets, asset] };
    try {
      await saveProfile(env, resolved.workspaceId, root, profile);
    } catch (error) {
      await env.ASSETS.delete(r2Key).catch(() => {});
      throw error;
    }

    return jsonResponse({
      ok: true,
      workspace_id: resolved.workspaceId,
      asset: { ...asset, download_url: assetDownloadPath(id) },
      design_profile: publicProfile(profile),
    });
  }

  if (assetId && (method === 'GET' || method === 'DELETE')) {
    if (!env.ASSETS?.get) return jsonResponse({ error: 'ASSETS storage not configured' }, 503);
    const resolved = await resolveWorkspaceId(env, authContext, url?.searchParams?.get('workspace_id'));
    if (resolved.error) return resolved.error;
    const root = await loadSettingsRoot(env, resolved.workspaceId);
    if (!root) return jsonResponse({ error: 'Workspace not found' }, 404);
    const profile = normalizeProfile(root.design_profile);
    const asset = profile.assets.find((row) => row.id === assetId);
    if (!asset) return jsonResponse({ error: 'Design asset not found' }, 404);

    if (method === 'DELETE') {
      await env.ASSETS.delete(asset.r2_key).catch(() => {});
      const next = { ...profile, assets: profile.assets.filter((row) => row.id !== assetId) };
      await saveProfile(env, resolved.workspaceId, root, next);
      return jsonResponse({ ok: true, design_profile: publicProfile(next) });
    }

    const object = await env.ASSETS.get(asset.r2_key);
    if (!object) return jsonResponse({ error: 'Design asset object missing' }, 404);
    const headers = new Headers();
    headers.set('Content-Type', asset.content_type || object.httpMetadata?.contentType || 'application/octet-stream');
    headers.set('Content-Disposition', `inline; filename="${asset.name.replace(/["\\]/g, '_')}"`);
    headers.set('Cache-Control', 'private, max-age=300');
    return new Response(object.body, { status: 200, headers });
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}

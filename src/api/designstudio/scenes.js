/**
 * Design Studio scene snapshots — D1 metadata + R2 entity blobs.
 *
 * R2 keys (bucket inneranimalmedia via env.ASSETS):
 *   scenes/{workspace_id}/{scene_id}.json       — named save
 *   scenes/{workspace_id}/autosave.json         — rolling autosave
 *   scenes/{workspace_id}/{scene_id}_thumb.png  — thumbnail (optional)
 */
import { jsonResponse, resolveRequestContext } from '../../core/auth.js';
import { platformR2WriteGateResponse } from '../../core/r2-storage-scope.js';
import { WORKSPACE_CONTEXT_MISSING } from '../../../backend/identity/bootstrap.js';

const TABLE = 'scene_snapshots';
const R2_BUCKET = 'inneranimalmedia';

function trim(s) {
  return s != null ? String(s).trim() : '';
}

function newSceneId() {
  return `scene_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/** @param {string} workspaceId @param {string} sceneId @param {boolean} autosave */
export function sceneEntitiesR2Key(workspaceId, sceneId, autosave = false) {
  const ws = trim(workspaceId);
  if (!ws) throw new Error('workspace_id required');
  if (autosave) return `scenes/${ws}/autosave.json`;
  const sid = trim(sceneId);
  if (!sid) throw new Error('scene_id required');
  return `scenes/${ws}/${sid}.json`;
}

export function sceneThumbnailR2Key(workspaceId, sceneId) {
  const ws = trim(workspaceId);
  const sid = trim(sceneId);
  if (!ws || !sid) return null;
  return `scenes/${ws}/${sid}_thumb.png`;
}

/** Same-origin URL served by Worker /assets/ → ASSETS.get(r2_key). */
export function scenePublicUrl(request, r2Key) {
  const key = trim(r2Key).replace(/^\/+/, '');
  if (!key) return null;
  try {
    const origin = new URL(request.url).origin;
    return `${origin}/assets/${key}`;
  } catch {
    return `/assets/${key}`;
  }
}

async function resolveActor(request, env) {
  const reqCtx = await resolveRequestContext(request, env);
  if (reqCtx.error) return { error: jsonResponse({ error: 'Unauthorized' }, 401) };

  const { userId, workspaceId, tenantId } = reqCtx;
  if (!workspaceId) {
    return {
      error: jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400),
    };
  }
  if (!tenantId) {
    return { error: jsonResponse({ error: 'tenant_id required', code: 'TENANT_CONTEXT_REQUIRED' }, 403) };
  }
  if (!userId) return { error: jsonResponse({ error: 'user_id required' }, 403) };

  const authUser = { id: userId, tenant_id: tenantId };
  return { authUser, workspaceId, tenantId, userId };
}

async function putEntitiesR2(env, r2Key, entities, authUser) {
  const denied = platformR2WriteGateResponse(authUser);
  if (denied) return denied;
  if (!env?.ASSETS?.put) throw new Error('ASSETS R2 binding not configured');
  const body = JSON.stringify({ version: 1, entities: Array.isArray(entities) ? entities : [] });
  await env.ASSETS.put(r2Key, body, {
    httpMetadata: { contentType: 'application/json' },
  });
  return body.length;
}

/** Rolling autosave must not 500 the dashboard poll loop — skip quietly when context/storage is unavailable. */
function autosaveSkippedResponse(reason = 'skipped') {
  return jsonResponse({ ok: true, skipped: true, reason });
}

async function getEntitiesR2(env, r2Key) {
  if (!env?.ASSETS?.get) throw new Error('ASSETS R2 binding not configured');
  const obj = await env.ASSETS.get(r2Key);
  if (!obj) return null;
  const text = await obj.text();
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.entities)) return parsed.entities;
    return [];
  } catch {
    return null;
  }
}

async function fetchSceneRow(env, sceneId, userId, workspaceId) {
  return env.DB.prepare(
    `SELECT id, workspace_id, user_id, tenant_id, name, project_type, entity_count,
            r2_key, r2_bucket, public_url, thumbnail_r2_key, thumbnail_url, tags,
            description, is_autosave, version, created_at, updated_at,
            project_id, glb_r2_key, cad_job_id, voxel_count, style_preset
     FROM ${TABLE}
     WHERE id = ? AND user_id = ? AND workspace_id = ?
     LIMIT 1`,
  )
    .bind(sceneId, userId, workspaceId)
    .first();
}

function rowToJson(row) {
  if (!row) return null;
  let tags = [];
  try {
    tags = JSON.parse(row.tags || '[]');
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    user_id: row.user_id,
    tenant_id: row.tenant_id,
    name: row.name,
    project_type: row.project_type,
    entity_count: row.entity_count,
    r2_key: row.r2_key,
    r2_bucket: row.r2_bucket,
    public_url: row.public_url,
    thumbnail_r2_key: row.thumbnail_r2_key,
    thumbnail_url: row.thumbnail_url,
    tags,
    description: row.description,
    is_autosave: Number(row.is_autosave) === 1,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    project_id: row.project_id ?? null,
    glb_r2_key: row.glb_r2_key ?? null,
    cad_job_id: row.cad_job_id ?? null,
    voxel_count: row.voxel_count ?? null,
    style_preset: row.style_preset ?? null,
  };
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {any} env
 */
export async function handleDesignStudioScenesApi(request, url, env) {
  const pathLower = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = (request.method || 'GET').toUpperCase();

  if (!env?.DB) return jsonResponse({ error: 'Database not configured' }, 503);

  // GET /api/designstudio/scenes — list metadata (no R2 blob)
  if (pathLower === '/api/designstudio/scenes' && method === 'GET') {
    const actor = await resolveActor(request, env);
    if (actor.error) return actor.error;

    const includeAutosave = url.searchParams.get('include_autosave') === '1';
    let sql = `SELECT id, workspace_id, user_id, name, project_type, entity_count, r2_key, public_url,
                      thumbnail_url, tags, description, is_autosave, version, created_at, updated_at,
                      project_id, glb_r2_key, cad_job_id, voxel_count, style_preset
               FROM ${TABLE}
               WHERE user_id = ? AND workspace_id = ?`;
    if (!includeAutosave) sql += ` AND is_autosave = 0`;
    sql += ` ORDER BY updated_at DESC LIMIT 100`;

    const { results } = await env.DB.prepare(sql).bind(actor.userId, actor.workspaceId).all();
    return jsonResponse({
      scenes: (results || []).map((r) => rowToJson(r)),
      workspace_id: actor.workspaceId,
    });
  }

  // PUT /api/designstudio/scenes/autosave
  if (pathLower === '/api/designstudio/scenes/autosave' && method === 'PUT') {
    try {
      let body = {};
      try {
        body = await request.json();
      } catch {
        return autosaveSkippedResponse('invalid_json');
      }
      const actor = await resolveActor(request, env);
      if (actor.error) return autosaveSkippedResponse('session_unresolved');

      const entities = body.entities;
      if (!Array.isArray(entities)) return autosaveSkippedResponse('entities_required');

      const r2Key = sceneEntitiesR2Key(actor.workspaceId, null, true);
      const entityCount = entities.length;
      const now = Math.floor(Date.now() / 1000);
      const publicUrl = scenePublicUrl(request, r2Key);
      const projectType = trim(body.project_type) || 'SANDBOX';
      const cadJobId = body.cad_job_id != null ? trim(body.cad_job_id) || null : null;
      const glbR2Key = body.glb_r2_key != null ? trim(body.glb_r2_key) || null : null;
      const requestedSceneId = trim(body.scene_id || body.id);

      const putDenied = await putEntitiesR2(env, r2Key, entities, actor.authUser);
      if (putDenied instanceof Response) return putDenied;

      const existing = await env.DB.prepare(
        `SELECT id FROM ${TABLE} WHERE user_id = ? AND workspace_id = ? AND is_autosave = 1 LIMIT 1`,
      )
        .bind(actor.userId, actor.workspaceId)
        .first();

      let sceneId;
      if (existing?.id) {
        sceneId = String(existing.id);
        await env.DB.prepare(
          `UPDATE ${TABLE}
           SET entity_count = ?, r2_key = ?, public_url = ?, project_type = ?, updated_at = ?,
               cad_job_id = COALESCE(?, cad_job_id),
               glb_r2_key = COALESCE(?, glb_r2_key)
           WHERE id = ? AND user_id = ? AND workspace_id = ?`,
        )
          .bind(
            entityCount,
            r2Key,
            publicUrl,
            projectType,
            now,
            cadJobId,
            glbR2Key,
            sceneId,
            actor.userId,
            actor.workspaceId,
          )
          .run();
      } else {
        sceneId = requestedSceneId || newSceneId();
        await env.DB.prepare(
          `INSERT INTO ${TABLE}
             (id, workspace_id, user_id, tenant_id, name, project_type, entity_count,
              r2_key, r2_bucket, public_url, is_autosave, version, created_at, updated_at,
              cad_job_id, glb_r2_key)
           VALUES (?, ?, ?, ?, 'Autosave', ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`,
        )
          .bind(
            sceneId,
            actor.workspaceId,
            actor.userId,
            actor.tenantId,
            projectType,
            entityCount,
            r2Key,
            R2_BUCKET,
            publicUrl,
            now,
            now,
            cadJobId,
            glbR2Key,
          )
          .run();
      }

      return jsonResponse({
        ok: true,
        scene: {
          id: sceneId,
          r2_key: r2Key,
          public_url: publicUrl,
          entity_count: entityCount,
          is_autosave: true,
          cad_job_id: cadJobId,
          glb_r2_key: glbR2Key,
        },
      });
    } catch (e) {
      console.warn('[designstudio autosave]', e?.message || e);
      return autosaveSkippedResponse('autosave_failed');
    }
  }

  // PUT /api/designstudio/scenes — named save (new or update by id)
  if (pathLower === '/api/designstudio/scenes' && method === 'PUT') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON' }, 400);
    }
    const actor = await resolveActor(request, env);
    if (actor.error) return actor.error;

    const entities = body.entities;
    if (!Array.isArray(entities)) return jsonResponse({ error: 'entities array required' }, 400);

    const name = trim(body.name) || 'Untitled Scene';
    const projectType = trim(body.project_type) || 'SANDBOX';
    const description = body.description != null ? String(body.description) : null;
    const tagsJson = Array.isArray(body.tags) ? JSON.stringify(body.tags) : '[]';
    const entityCount = entities.length;
    const now = Math.floor(Date.now() / 1000);
    const projectId = body.project_id != null ? trim(body.project_id) || null : null;
    const glbR2Key = body.glb_r2_key != null ? trim(body.glb_r2_key) || null : null;
    const cadJobId = body.cad_job_id != null ? trim(body.cad_job_id) || null : null;
    const voxelCount =
      body.voxel_count != null && Number.isFinite(Number(body.voxel_count))
        ? Number(body.voxel_count)
        : null;
    const stylePreset = body.style_preset != null ? trim(body.style_preset) || null : null;

    let sceneId = trim(body.id || body.scene_id);
    const updating = !!sceneId;

    if (updating) {
      const row = await fetchSceneRow(env, sceneId, actor.userId, actor.workspaceId);
      if (!row || Number(row.is_autosave) === 1) {
        return jsonResponse({ error: 'Not found' }, 404);
      }
    } else {
      sceneId = newSceneId();
    }

    const r2Key = sceneEntitiesR2Key(actor.workspaceId, sceneId, false);
    const publicUrl = scenePublicUrl(request, r2Key);

    const putDenied = await putEntitiesR2(env, r2Key, entities, actor.authUser);
    if (putDenied instanceof Response) return putDenied;

    if (updating) {
      await env.DB.prepare(
        `UPDATE ${TABLE}
         SET name = ?, project_type = ?, entity_count = ?, r2_key = ?, public_url = ?,
             description = ?, tags = ?, version = version + 1, updated_at = ?,
             project_id = COALESCE(?, project_id),
             glb_r2_key = COALESCE(?, glb_r2_key),
             cad_job_id = COALESCE(?, cad_job_id),
             voxel_count = COALESCE(?, voxel_count),
             style_preset = COALESCE(?, style_preset)
         WHERE id = ? AND user_id = ? AND workspace_id = ? AND is_autosave = 0`,
      )
        .bind(
          name,
          projectType,
          entityCount,
          r2Key,
          publicUrl,
          description,
          tagsJson,
          now,
          projectId,
          glbR2Key,
          cadJobId,
          voxelCount,
          stylePreset,
          sceneId,
          actor.userId,
          actor.workspaceId,
        )
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO ${TABLE}
           (id, workspace_id, user_id, tenant_id, name, project_type, entity_count,
            r2_key, r2_bucket, public_url, description, tags, is_autosave, version, created_at, updated_at,
            project_id, glb_r2_key, cad_job_id, voxel_count, style_preset)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          sceneId,
          actor.workspaceId,
          actor.userId,
          actor.tenantId,
          name,
          projectType,
          entityCount,
          r2Key,
          R2_BUCKET,
          publicUrl,
          description,
          tagsJson,
          now,
          now,
          projectId,
          glbR2Key,
          cadJobId,
          voxelCount,
          stylePreset,
        )
        .run();
    }

    const row = await fetchSceneRow(env, sceneId, actor.userId, actor.workspaceId);
    return jsonResponse({ ok: true, scene: rowToJson(row) }, updating ? 200 : 201);
  }

  const oneMatch = pathLower.match(/^\/api\/designstudio\/scenes\/([^/]+)$/);
  const entitiesMatch = pathLower.match(/^\/api\/designstudio\/scenes\/([^/]+)\/entities$/);

  // GET /api/designstudio/scenes/:id/entities — stream R2 JSON
  if (entitiesMatch && method === 'GET') {
    const actor = await resolveActor(request, env);
    if (actor.error) return actor.error;

    const sceneId = entitiesMatch[1];
    const row = await fetchSceneRow(env, sceneId, actor.userId, actor.workspaceId);
    if (!row) return jsonResponse({ error: 'Not found' }, 404);

    const entities = await getEntitiesR2(env, row.r2_key);
    if (entities === null) return jsonResponse({ error: 'Scene blob missing in R2', r2_key: row.r2_key }, 404);

    return jsonResponse({
      scene_id: row.id,
      workspace_id: row.workspace_id,
      entity_count: entities.length,
      entities,
    });
  }

  // GET /api/designstudio/scenes/:id — metadata only
  if (oneMatch && method === 'GET') {
    const actor = await resolveActor(request, env);
    if (actor.error) return actor.error;

    const row = await fetchSceneRow(env, oneMatch[1], actor.userId, actor.workspaceId);
    if (!row) return jsonResponse({ error: 'Not found' }, 404);
    return jsonResponse({ scene: rowToJson(row) });
  }

  // DELETE /api/designstudio/scenes/:id
  if (oneMatch && method === 'DELETE') {
    const actor = await resolveActor(request, env);
    if (actor.error) return actor.error;

    const sceneId = oneMatch[1];
    const row = await fetchSceneRow(env, sceneId, actor.userId, actor.workspaceId);
    if (!row) return jsonResponse({ error: 'Not found' }, 404);
    if (Number(row.is_autosave) === 1) {
      return jsonResponse({ error: 'Cannot delete autosave row' }, 400);
    }

    await env.DB.prepare(`DELETE FROM ${TABLE} WHERE id = ? AND user_id = ? AND workspace_id = ?`)
      .bind(sceneId, actor.userId, actor.workspaceId)
      .run();

    if (env.ASSETS?.delete && row.r2_key) {
      await env.ASSETS.delete(String(row.r2_key)).catch(() => {});
      if (row.thumbnail_r2_key) await env.ASSETS.delete(String(row.thumbnail_r2_key)).catch(() => {});
    }

    return jsonResponse({ ok: true, deleted_id: sceneId });
  }

  return null;
}

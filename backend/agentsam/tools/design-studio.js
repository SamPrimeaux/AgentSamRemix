import {
  cadEngineSystemPrompt,
  cancelCadJobForUser,
  generateCadScriptJob,
} from '../../../src/api/cad.js';
import { dispatchCadJob } from '../../../src/core/cad-dispatch.js';
import { buildCadAssetPublicUrl } from '../../../src/core/cad-job-scope.js';

/**
 * agentsam_cad_jobs has no `public_url` column — derive it from the R2 key
 * (dedicated cad bucket / custom domain) with result_url as fallback.
 * @param {any} row
 * @param {any} env
 */
function withCadJobPublicUrl(row, env) {
  if (!row || typeof row !== 'object') return row;
  const r2Key = String(row.r2_key || '').trim();
  const derived =
    r2Key && !r2Key.startsWith('b64:') && !r2Key.includes('\n')
      ? buildCadAssetPublicUrl(r2Key, env?.CAD_R2_PUBLIC_ORIGIN)
      : '';
  return { ...row, public_url: derived || (row.result_url ? String(row.result_url) : null) };
}

function scopeFromContext(params, runContext) {
  const userId = String(runContext.userId ?? runContext.user_id ?? params.user_id ?? '').trim();
  const workspaceId = String(
    runContext.workspaceId ?? runContext.workspace_id ?? params.workspace_id ?? '',
  ).trim();
  const tenantId = String(
    runContext.tenantId ?? runContext.tenant_id ?? params.tenant_id ?? '',
  ).trim();
  if (!userId || !workspaceId || !tenantId) {
    throw new Error('Design Studio tool requires authenticated user, workspace, and tenant scope');
  }
  return {
    userId,
    workspaceId,
    tenantId,
    sessionId: String(
      runContext.sessionId ?? runContext.session_id ?? params.session_id ?? '',
    ).trim() || null,
    projectId: String(params.project_id ?? params.blueprint_id ?? '').trim() || null,
    sceneSnapshotId:
      String(params.scene_snapshot_id ?? params.scene_id ?? '').trim() || null,
  };
}

async function listScenes(params, env, runContext) {
  const scope = scopeFromContext(params, runContext);
  const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 50);
  const { results } = await env.DB.prepare(
    `SELECT id, name, project_type, entity_count, public_url, thumbnail_url,
            description, tags, version, project_id, glb_r2_key, cad_job_id,
            style_preset, updated_at
     FROM scene_snapshots
     WHERE user_id = ? AND workspace_id = ? AND is_autosave = 0
     ORDER BY updated_at DESC
     LIMIT ?`,
  )
    .bind(scope.userId, scope.workspaceId, limit)
    .all();
  return { scenes: results || [], count: results?.length || 0 };
}

async function listAssets(params, env, runContext) {
  const scope = scopeFromContext(params, runContext);
  const limit = Math.min(Math.max(Number(params.limit) || 30, 1), 50);
  const { results } = await env.DB.prepare(
    `SELECT id, filename, tags, public_url, thumbnail_url, metadata, category, created_at
     FROM cms_assets
     WHERE is_live = 1
       AND (category = '3d_studio' OR (category = '3d_studio_user' AND created_by = ?))
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(scope.userId, limit)
    .all();
  return { assets: results || [], count: results?.length || 0 };
}

async function cadJobStatus(params, env, runContext) {
  const scope = scopeFromContext(params, runContext);
  const jobId = String(params.job_id ?? params.id ?? '').trim();
  const limit = Math.min(Math.max(Number(params.limit) || 10, 1), 20);
  const fields = `id AS job_id, engine, prompt, mode, status, progress_pct,
                  result_url, r2_key, r2_bucket, task_type, external_task_id, parent_task_id, rig_task_id,
                  model_formats, scene_snapshot_id, created_at, updated_at, finished_at`;
  if (jobId) {
    const job = await env.DB.prepare(
      `SELECT ${fields}
       FROM agentsam_cad_jobs
       WHERE id = ? AND user_id = ? AND workspace_id = ? AND tenant_id = ?
       LIMIT 1`,
    )
      .bind(jobId, scope.userId, scope.workspaceId, scope.tenantId)
      .first();
    return job ? { job: withCadJobPublicUrl(job, env) } : { error: 'CAD job not found' };
  }
  const { results } = await env.DB.prepare(
    `SELECT ${fields}
     FROM agentsam_cad_jobs
     WHERE user_id = ? AND workspace_id = ? AND tenant_id = ?
     ORDER BY updated_at DESC
     LIMIT ?`,
  )
    .bind(scope.userId, scope.workspaceId, scope.tenantId, limit)
    .all();
  const jobs = (results || []).map((r) => withCadJobPublicUrl(r, env));
  return { jobs, count: jobs.length };
}

async function cadJobCancel(params, env, runContext) {
  const scope = scopeFromContext(params, runContext);
  const jobId = String(params.job_id ?? params.id ?? '').trim();
  if (!jobId) return { error: 'job_id required' };
  const owned = await env.DB.prepare(
    `SELECT id FROM agentsam_cad_jobs
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND tenant_id = ?
     LIMIT 1`,
  )
    .bind(jobId, scope.userId, scope.workspaceId, scope.tenantId)
    .first();
  if (!owned) return { error: 'CAD job not found' };
  return cancelCadJobForUser(
    env,
    { id: scope.userId, tenant_id: scope.tenantId },
    jobId,
  );
}

async function cadGenerate(params, env, runContext) {
  const scope = scopeFromContext(params, runContext);
  const engine = String(params.engine || '').trim().toLowerCase();
  if (!['openscad', 'freecad', 'blender'].includes(engine)) {
    return { error: 'engine must be openscad, freecad, or blender' };
  }
  const prompt = String(params.prompt || params.description || '').trim();
  if (!prompt) return { error: 'prompt required' };
  const generated = await generateCadScriptJob(env, {
    authUser: { id: scope.userId, tenant_id: scope.tenantId },
    scope,
    engine,
    prompt,
    systemPrompt: cadEngineSystemPrompt(engine),
    userContent: `Generate a production-ready ${engine} script for this request:\n${prompt}`,
    mode: 'text',
    // The script-generation LLM is resolved by the system (routing arms), never chosen by
    // the calling agent — forwarding an agent-supplied model_key here caused MODEL_NOT_FOUND
    // when the model treated it as a name for the CAD object (e.g. "cube_40mm_center_hole_15mm").
    requestedModelKey: null,
  });
  if (generated?.error) return generated;

  // Mark runnable then auto-dispatch (same path as POST /api/cad/jobs/:id/execute).
  await env.DB.prepare(
    `UPDATE agentsam_cad_jobs SET
       status = 'pending',
       progress_pct = 0,
       error = NULL,
       error_code = NULL,
       updated_at = unixepoch()
     WHERE id = ?`,
  )
    .bind(generated.jobId)
    .run();

  const execCtx = runContext?.executionCtx ?? runContext?.ctx ?? null;
  const execAuth = {
    userId: scope.userId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
  };
  let dispatched = false;
  const runDispatch = async () => {
    try {
      await dispatchCadJob(env, execCtx, generated.jobId, execAuth);
    } catch (e) {
      console.warn('[cad_generate] auto-dispatch failed:', generated.jobId, e?.message ?? e);
    }
  };
  if (execCtx && typeof execCtx.waitUntil === 'function') {
    execCtx.waitUntil(runDispatch());
    dispatched = true;
  } else {
    await runDispatch();
    dispatched = true;
  }

  return {
    ok: true,
    job_id: generated.jobId,
    engine,
    status: 'running',
    model_key: generated.model_key,
    dispatched,
    next_step:
      'Poll cad_job_status until done. Design Studio auto-spawns the GLB into the viewport — do not paste the CAD source unless the user explicitly asked for source code.',
  };
}

async function blueprintList(params, env, runContext) {
  const scope = scopeFromContext(params, runContext);
  const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 50);
  const status = String(params.status || '').trim();
  let sql = `SELECT id, title, description, original_prompt, status, cad_engine,
                    preview_image_url, preview_svg_url, latest_asset_id,
                    created_at, updated_at
             FROM designstudio_design_blueprints
             WHERE tenant_id = ? AND workspace_id = ?`;
  const binds = [scope.tenantId, scope.workspaceId];
  if (status) {
    sql += ` AND status = ?`;
    binds.push(status);
  }
  sql += ` ORDER BY updated_at DESC LIMIT ?`;
  binds.push(limit);
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return { blueprints: results || [], count: results?.length || 0 };
}

async function blueprintGet(params, env, runContext) {
  const scope = scopeFromContext(params, runContext);
  const id = String(params.blueprint_id ?? params.id ?? '').trim();
  if (!id) return { error: 'blueprint_id required' };
  const row = await env.DB.prepare(
    `SELECT * FROM designstudio_design_blueprints
     WHERE id = ? AND tenant_id = ? AND workspace_id = ?
     LIMIT 1`,
  )
    .bind(id, scope.tenantId, scope.workspaceId)
    .first();
  return row ? { blueprint: row } : { error: 'Blueprint not found' };
}

async function blueprintCreate(params, env, runContext) {
  const scope = scopeFromContext(params, runContext);
  const title = String(params.title || '').trim();
  if (!title) return { error: 'title required' };
  const description =
    params.description != null && String(params.description).trim() !== ''
      ? String(params.description).trim()
      : null;
  const originalPrompt =
    params.original_prompt != null && String(params.original_prompt).trim() !== ''
      ? String(params.original_prompt).trim()
      : description || title;
  const sketchJson =
    typeof params.sketch_json === 'object' && params.sketch_json !== null
      ? JSON.stringify(params.sketch_json)
      : typeof params.sketch_json === 'string'
        ? params.sketch_json
        : '{}';
  const tagsJson = Array.isArray(params.tags)
    ? JSON.stringify(params.tags)
    : typeof params.tags === 'string'
      ? params.tags
      : '[]';
  const setActive = params.set_active !== false && params.set_active !== 0;

  const row = await env.DB.prepare(
    `INSERT INTO designstudio_design_blueprints
       (tenant_id, workspace_id, title, description, original_prompt, sketch_json, tags, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')
     RETURNING *`,
  )
    .bind(scope.tenantId, scope.workspaceId, title, description, originalPrompt, sketchJson, tagsJson)
    .first();

  if (!row?.id) return { error: 'Failed to create blueprint' };

  if (setActive && env.IAM_COLLAB) {
    try {
      const { broadcastToCollabCanvas } = await import('../../../src/core/collab-broadcast.js');
      await broadcastToCollabCanvas(env, scope.workspaceId, {
        type: 'iam_designstudio',
        action: 'select_blueprint',
        params: { blueprint_id: String(row.id), title: row.title },
      });
    } catch (e) {
      console.warn('[designstudio_blueprint_create] select broadcast failed', e?.message ?? e);
    }
  }

  return {
    ok: true,
    blueprint: row,
    blueprint_id: row.id,
    set_active: setActive,
    next_step:
      'Blueprint is active in Design Studio. For a 2D floor plan, open Draw plan mode or ask on /dashboard/draw. Do not call cad_generate until the user asks for 3D.',
  };
}

async function blueprintUpdate(params, env, runContext) {
  const scope = scopeFromContext(params, runContext);
  const id = String(params.blueprint_id ?? params.id ?? '').trim();
  if (!id) return { error: 'blueprint_id required' };
  const existing = await env.DB.prepare(
    `SELECT id FROM designstudio_design_blueprints
     WHERE id = ? AND tenant_id = ? AND workspace_id = ?
     LIMIT 1`,
  )
    .bind(id, scope.tenantId, scope.workspaceId)
    .first();
  if (!existing) return { error: 'Blueprint not found' };

  const sets = [];
  const vals = [];
  const push = (col, v) => {
    sets.push(`${col} = ?`);
    vals.push(v);
  };
  if (params.title != null) push('title', String(params.title).trim());
  if (params.description !== undefined) {
    push('description', params.description != null ? String(params.description) : null);
  }
  if (params.original_prompt !== undefined) {
    push('original_prompt', params.original_prompt != null ? String(params.original_prompt) : null);
  }
  if (params.status != null) push('status', String(params.status).trim());
  if (params.preview_image_url !== undefined) {
    push(
      'preview_image_url',
      params.preview_image_url != null && String(params.preview_image_url).trim() !== ''
        ? String(params.preview_image_url).trim()
        : null,
    );
  }
  if (params.preview_svg_url !== undefined) {
    push(
      'preview_svg_url',
      params.preview_svg_url != null && String(params.preview_svg_url).trim() !== ''
        ? String(params.preview_svg_url).trim()
        : null,
    );
  }
  if (params.sketch_json !== undefined) {
    push(
      'sketch_json',
      typeof params.sketch_json === 'object'
        ? JSON.stringify(params.sketch_json)
        : String(params.sketch_json || '{}'),
    );
  }
  if (params.set_active === true || params.set_active === 1) {
    try {
      const { broadcastToCollabCanvas } = await import('../../../src/core/collab-broadcast.js');
      await broadcastToCollabCanvas(env, scope.workspaceId, {
        type: 'iam_designstudio',
        action: 'select_blueprint',
        params: { blueprint_id: id },
      });
    } catch (e) {
      console.warn('[designstudio_blueprint_update] select broadcast failed', e?.message ?? e);
    }
  }
  if (!sets.length) {
    const row = await env.DB.prepare(`SELECT * FROM designstudio_design_blueprints WHERE id = ?`)
      .bind(id)
      .first();
    return { ok: true, blueprint: row, unchanged: true };
  }
  sets.push(`updated_at = datetime('now')`);
  vals.push(id, scope.tenantId, scope.workspaceId);
  await env.DB.prepare(
    `UPDATE designstudio_design_blueprints SET ${sets.join(', ')}
     WHERE id = ? AND tenant_id = ? AND workspace_id = ?`,
  )
    .bind(...vals)
    .run();
  const row = await env.DB.prepare(`SELECT * FROM designstudio_design_blueprints WHERE id = ?`)
    .bind(id)
    .first();
  return { ok: true, blueprint: row };
}

export const handlers = {
  designstudio_scene_list: listScenes,
  designstudio_asset_list: listAssets,
  designstudio_blueprint_list: blueprintList,
  designstudio_blueprint_get: blueprintGet,
  designstudio_blueprint_create: blueprintCreate,
  designstudio_blueprint_update: blueprintUpdate,
  cad_job_status: cadJobStatus,
  cad_job_cancel: cadJobCancel,
  cad_generate: cadGenerate,
};

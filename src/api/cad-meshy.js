/**
 * Meshy CAD route handlers — balance, text-to-3d preview/refine, task CRUD, generate.
 */
import { jsonResponse, resolveRequestContext } from '../core/auth.js';
import { resolveCadJobScope } from '../core/cad-job-scope.js';
import { scheduleMeshyCadJobReconcile } from '../core/meshy-cad-reconcile.js';
import { applyMeshyTaskToCadJob } from '../core/meshy-cad-sync.js';
import { buildCadAssetPublicUrl } from '../core/cad-job-scope.js';
import {
  checkMeshyBalance,
  checkMeshyBalanceForOperation,
  createMeshyTask,
  deleteMeshyTask,
  getBalance,
  getMeshyTask,
  listMeshyTasks,
  meshyApiKey,
  meshyErrorResponseBody,
  streamMeshyTask,
  buildMeshyAnimationPayload,
  buildMeshyImageTo3dPayload,
  buildMeshyRiggingPayload,
  buildMeshyRetexturePayload,
  buildMeshyPrintMultiColorPayload,
  textTo3dPreview,
  textTo3dRefine,
} from '../core/meshy-api.js';
import {
  estimateImageTo3dCost,
  estimateTextTo3dFullCost,
  estimateTextTo3dPreviewCost,
  MESHY_CREDIT_COSTS,
  estimateMeshyOperationCost,
} from '../core/meshy-credits.js';
import { bridgedToolRequest, primeRequestAuthForTool } from '../core/meshy-tool-auth.js';
import {
  isMeshyAuthMissing,
  isMeshyKeyStub,
  meshyKeySourceFromJob,
  resolveMeshyAuth,
  textureDataWithMeshySource,
} from '../core/meshy-api-key.js';

// Re-export for tool bridge
export { getBalance, checkMeshyBalance };

/**
 * @param {any} env
 * @param {Record<string, unknown>} fields
 * @param {ExecutionContext | null | undefined} [ctx]
 */
export async function insertMeshyCadJob(env, fields, ctx = null) {
  await env.DB.prepare(
    `INSERT INTO agentsam_cad_jobs (
       id, user_id, session_id, engine, prompt, mode, status,
       external_task_id, r2_key, r2_bucket, workspace_id, tenant_id,
       project_id, scene_snapshot_id, progress_pct,
       task_type, parent_task_id, rig_task_id, credits_consumed,
       model_formats, texture_data,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`,
  )
    .bind(
      fields.id,
      fields.user_id,
      fields.session_id ?? null,
      fields.engine ?? 'meshy',
      fields.prompt ?? '',
      fields.mode ?? 'text',
      fields.status,
      fields.external_task_id ?? null,
      fields.r2_key ?? null,
      fields.r2_bucket ?? 'inneranimalmedia',
      fields.workspace_id ?? null,
      fields.tenant_id ?? null,
      fields.project_id ?? null,
      fields.scene_snapshot_id ?? null,
      Number(fields.progress_pct) || 0,
      fields.task_type ?? 'text-to-3d',
      fields.parent_task_id ?? null,
      fields.rig_task_id ?? null,
      Number(fields.credits_consumed) || 0,
      fields.model_formats != null ? JSON.stringify(fields.model_formats) : null,
      fields.texture_data != null ? JSON.stringify(fields.texture_data) : null,
    )
    .run();

  const extId = fields.external_task_id != null ? String(fields.external_task_id).trim() : '';
  const jobId = fields.id != null ? String(fields.id).trim() : '';
  if (ctx && extId && jobId) {
    scheduleMeshyCadJobReconcile(env, ctx, jobId);
  }
}

/** UI rail / API aliases → Meshy OpenAPI task route key. */
const MESHY_TASK_TYPE_ALIASES = {
  'text-to-texture': 'retexture',
  texture: 'retexture',
  'post-process': 'remesh',
  image: 'text-to-image',
  print: 'print-multi-color',
  'multi-color': 'print-multi-color',
  'print-multi-color': 'print-multi-color',
  unwrap: 'uv-unwrap',
  uvunwrap: 'uv-unwrap',
  'uv_unwrap': 'uv-unwrap',
};

/**
 * Build remesh body per https://docs.meshy.ai/en/api/remesh
 * Prefer dedicated Resize/Convert APIs for size/format-only work.
 * @param {Record<string, unknown>} body
 */
function buildMeshyRemeshPayload(body) {
  const inputTaskId = String(body.input_task_id || body.model_task_id || '').trim();
  const modelUrl = String(body.model_url || '').trim();
  if (!inputTaskId && !modelUrl) throw new Error('input_task_id or model_url required');

  /** @type {Record<string, unknown>} */
  const payload = {
    ...(inputTaskId ? { input_task_id: inputTaskId } : {}),
    ...(modelUrl ? { model_url: modelUrl } : {}),
    target_formats: Array.isArray(body.target_formats)
      ? body.target_formats
      : body.target_formats
        ? [body.target_formats]
        : ['glb'],
    topology: body.topology === 'quad' ? 'quad' : 'triangle',
  };

  if (body.decimation_mode != null && body.decimation_mode !== '') {
    const mode = Number(body.decimation_mode);
    if (![1, 2, 3, 4].includes(mode)) {
      throw new Error('decimation_mode must be 1|2|3|4 (ultra|high|medium|low)');
    }
    payload.decimation_mode = mode;
  } else if (body.target_polycount != null && body.target_polycount !== '') {
    payload.target_polycount = Number(body.target_polycount);
  }

  if (body.alpha_thumbnail === true) payload.alpha_thumbnail = true;

  // Deprecated remesh resize/convert flags — accepted for compat; prefer /resize and /convert.
  const hasResizeHeight = body.resize_height != null && Number(body.resize_height) > 0;
  const hasLongest = body.resize_longest_side != null && Number(body.resize_longest_side) > 0;
  const hasAuto = body.auto_size === true;
  const resizeCount = [hasResizeHeight, hasLongest, hasAuto].filter(Boolean).length;
  if (resizeCount > 1) {
    throw new Error('auto_size, resize_height, and resize_longest_side are mutually exclusive');
  }
  if (hasResizeHeight) payload.resize_height = Number(body.resize_height);
  if (hasLongest) payload.resize_longest_side = Number(body.resize_longest_side);
  if (hasAuto) {
    payload.auto_size = true;
    if (body.origin_at === 'center' || body.origin_at === 'bottom') {
      payload.origin_at = body.origin_at;
    }
  }
  if (body.convert_format_only === true) {
    payload.convert_format_only = true;
    if (!payload.target_formats?.length) {
      throw new Error('target_formats required when convert_format_only is true');
    }
  }

  return { payload, inputTaskId, modelUrl };
}

/**
 * Build convert body per https://docs.meshy.ai/en/api/convert
 * @param {Record<string, unknown>} body
 */
function buildMeshyConvertPayload(body) {
  const inputTaskId = String(body.input_task_id || body.model_task_id || '').trim();
  const modelUrl = String(body.model_url || '').trim();
  if (!inputTaskId && !modelUrl) throw new Error('input_task_id or model_url required');
  const formats = Array.isArray(body.target_formats)
    ? body.target_formats
    : body.target_formats
      ? [body.target_formats]
      : [];
  if (!formats.length) throw new Error('target_formats required');
  return {
    payload: {
      ...(inputTaskId ? { input_task_id: inputTaskId } : {}),
      ...(modelUrl ? { model_url: modelUrl } : {}),
      target_formats: formats,
    },
    inputTaskId,
    modelUrl,
  };
}

/**
 * Build resize body per https://docs.meshy.ai/en/api/resize
 * @param {Record<string, unknown>} body
 */
function buildMeshyResizePayload(body) {
  const inputTaskId = String(body.input_task_id || body.model_task_id || '').trim();
  const modelUrl = String(body.model_url || '').trim();
  if (!inputTaskId && !modelUrl) throw new Error('input_task_id or model_url required');

  const hasHeight = body.resize_height != null && Number(body.resize_height) > 0;
  const hasLongest = body.resize_longest_side != null && Number(body.resize_longest_side) > 0;
  const hasAuto = body.auto_size === true;
  const modeCount = [hasHeight, hasLongest, hasAuto].filter(Boolean).length;
  if (modeCount !== 1) {
    throw new Error('Exactly one of resize_height, resize_longest_side, or auto_size is required');
  }

  /** @type {Record<string, unknown>} */
  const payload = {
    ...(inputTaskId ? { input_task_id: inputTaskId } : {}),
    ...(modelUrl ? { model_url: modelUrl } : {}),
  };
  if (hasHeight) payload.resize_height = Number(body.resize_height);
  if (hasLongest) payload.resize_longest_side = Number(body.resize_longest_side);
  if (hasAuto) payload.auto_size = true;
  if (body.origin_at === 'center' || body.origin_at === 'bottom') {
    payload.origin_at = body.origin_at;
  }
  return { payload, inputTaskId, modelUrl };
}

function meshyAuthCtx(reqCtx) {
  return { userId: reqCtx.userId, tenant_id: reqCtx.tenantId };
}

/**
 * @param {any} env
 * @param {{ userId?: string; tenantId?: string }} reqCtx
 * @param {Record<string, unknown> | null} [job]
 */
async function resolveRequestMeshyAuth(env, reqCtx, job = null) {
  return resolveMeshyAuth(env, meshyAuthCtx(reqCtx), {
    keySource: job ? meshyKeySourceFromJob(job) : null,
  });
}

function meshyStubMessage() {
  return 'No Meshy API key configured. Add your key in Settings → Keys or set MESHYAI_API_KEY on the Worker.';
}

function logMeshyAuthResolution(reqCtx, meshyAuth, env) {
  const platformKey = meshyApiKey(env);
  console.info('[meshy] auth resolve', {
    userId: reqCtx?.userId ?? null,
    tenantId: reqCtx?.tenantId ?? null,
    source: meshyAuth?.source ?? 'none',
    hasResolvedKey: Boolean(meshyAuth?.apiKey && !isMeshyKeyStub(meshyAuth.apiKey)),
    platformKeyConfigured: Boolean(platformKey && !isMeshyKeyStub(platformKey)),
  });
}

/**
 * Start a Meshy task and persist agentsam_cad_jobs row.
 * @param {any} env
 * @param {Request} authRequest
 * @param {{ id: string; tenant_id?: string }} authUser
 * @param {Record<string, unknown>} body
 * @param {string} taskType
 * @param {{ apiKey?: string | null; source?: string }} meshyAuth
 * @param {ExecutionContext | null | undefined} [ctx]
 */
async function startMeshyCadJob(env, authRequest, authUser, body, taskType, meshyAuth, ctx = null) {
  const normalized = MESHY_TASK_TYPE_ALIASES[taskType] || taskType;
  const op =
    normalized === 'text-to-image'
      ? 'text-to-image'
      : normalized === 'uv-unwrap'
        ? 'uv-unwrap'
        : normalized;

  if (isMeshyAuthMissing(meshyAuth)) {
    return { stub: true, message: meshyStubMessage() };
  }

  await checkMeshyBalanceForOperation(env, op, body, meshyAuth);

  const scope = await resolveCadJobScope(env, authRequest, authUser, body);
  const inputTaskId = String(body.input_task_id || body.model_task_id || '').trim();
  const modelUrl = String(body.model_url || '').trim();

  /** @type {Record<string, unknown>} */
  let payload = {};

  if (normalized === 'retexture') {
    const built = buildMeshyRetexturePayload(body);
    payload = built.payload;
  } else if (normalized === 'print-multi-color') {
    const built = buildMeshyPrintMultiColorPayload(body);
    payload = built.payload;
  } else if (normalized === 'remesh') {
    const built = buildMeshyRemeshPayload(body);
    payload = built.payload;
  } else if (normalized === 'convert') {
    const built = buildMeshyConvertPayload(body);
    payload = built.payload;
  } else if (normalized === 'resize') {
    const built = buildMeshyResizePayload(body);
    payload = built.payload;
  } else if (normalized === 'text-to-image') {
    const prompt = String(body.prompt || '').trim();
    if (!prompt) throw new Error('prompt required');
    payload = {
      ai_model: body.ai_model || 'nano-banana',
      prompt,
      aspect_ratio: body.aspect_ratio || '1:1',
      generate_multi_view: body.generate_multi_view === true,
      ...(body.pose_mode ? { pose_mode: body.pose_mode } : {}),
    };
  } else if (normalized === 'animation') {
    const built = buildMeshyAnimationPayload(body);
    payload = built.payload;
  } else if (normalized === 'uv-unwrap') {
    if (!inputTaskId && !modelUrl) throw new Error('input_task_id or model_url required');
    payload = {
      ...(inputTaskId ? { input_task_id: inputTaskId } : {}),
      ...(modelUrl ? { model_url: modelUrl } : {}),
    };
  } else if (normalized === 'multi-image-to-3d') {
    const imageUrls = Array.isArray(body.image_urls) ? body.image_urls.map(String).filter(Boolean) : [];
    if (imageUrls.length < 1 || imageUrls.length > 4) {
      throw new Error('image_urls must contain 1–4 images');
    }
    payload = {
      image_urls: imageUrls,
      should_texture: body.should_texture !== false,
      enable_pbr: body.enable_pbr === true,
      ai_model: body.ai_model || 'latest',
      ...(body.target_formats ? { target_formats: body.target_formats } : {}),
      ...(body.image_enhancement != null ? { image_enhancement: body.image_enhancement === true } : {}),
      ...(body.remove_lighting != null ? { remove_lighting: body.remove_lighting === true } : {}),
    };
  } else {
    throw new Error(`unsupported task_type: ${taskType}`);
  }

  const { task_id: externalTaskId, raw } = await createMeshyTask(env, normalized, payload, meshyAuth);
  if (!externalTaskId) {
    throw new Error(`Meshy did not return task id for ${normalized}`);
  }

  const jobId = 'cadj_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const promptLabel =
    String(body.prompt || body.texture_prompt || '').trim() ||
    (inputTaskId ? `${normalized}:${inputTaskId.slice(0, 8)}` : normalized);

  await insertMeshyCadJob(env, {
    id: jobId,
    user_id: authUser.id,
    session_id: scope.sessionId,
    engine: 'meshy',
    prompt: promptLabel,
    mode: normalized,
    status: 'pending',
    external_task_id: externalTaskId,
    parent_task_id: inputTaskId || String(body.rig_task_id || '') || null,
    workspace_id: scope.workspaceId,
    tenant_id: scope.tenantId,
    project_id: scope.projectId,
    scene_snapshot_id: scope.sceneSnapshotId,
    task_type: normalized,
    credits_consumed: estimateMeshyOperationCost(op, body),
    rig_task_id: body.rig_task_id ? String(body.rig_task_id) : null,
    texture_data: textureDataWithMeshySource(body.texture_data, meshyAuth.source === 'byok' ? 'byok' : 'platform'),
  }, ctx);

  return {
    job_id: jobId,
    task_id: externalTaskId,
    external_task_id: externalTaskId,
    status: 'pending',
    phase: taskType,
    workspace_id: scope.workspaceId,
    meshy: raw,
  };
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {any} env
 * @param {any} ctx
 */
export async function handleCadMeshyApi(request, url, env, ctx) {
  const method = request.method.toUpperCase();
  const path = url.pathname.toLowerCase();
  const authRequest = bridgedToolRequest(request);

  const reqCtx = await resolveRequestContext(authRequest, env);
  if (reqCtx.error) return jsonResponse({ error: 'Unauthorized' }, 401);
  const authUser = { id: reqCtx.userId, tenant_id: reqCtx.tenantId };
  if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);

  const insertJob = (fields) => insertMeshyCadJob(env, fields, ctx);
  const startJob = (authReq, user, body, taskType, meshyAuth) =>
    startMeshyCadJob(env, authReq, user, body, taskType, meshyAuth, ctx);

  try {
    if (path === '/api/cad/meshy/balance' && method === 'GET') {
      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      if (isMeshyAuthMissing(meshyAuth)) {
        return jsonResponse({
          balance: 0,
          stub: true,
          key_source: 'none',
          message: meshyStubMessage(),
        });
      }
      const { balance, raw } = await getBalance(env, meshyAuth);
      return jsonResponse({ balance, raw, key_source: meshyAuth.source });
    }

    if (path === '/api/cad/meshy/text-to-3d/preview' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (!body.prompt && !body.texture_prompt) {
        return jsonResponse({ error: 'prompt required' }, 400);
      }

      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      if (isMeshyAuthMissing(meshyAuth)) {
        return jsonResponse({
          stub: true,
          key_source: 'none',
          message: meshyStubMessage(),
        });
      }

      try {
        await checkMeshyBalanceForOperation(env, 'text-to-3d-preview', body, meshyAuth);
      } catch (e) {
        const mapped = meshyErrorResponseBody(e);
        return jsonResponse(mapped.body, mapped.status);
      }

      const scope = await resolveCadJobScope(env, authRequest, authUser, body);
      const { task_id: externalTaskId, raw } = await textTo3dPreview(env, body, meshyAuth);
      if (!externalTaskId) {
        return jsonResponse({ error: 'Meshy did not return task id', meshy: raw }, 502);
      }

      const jobId = 'cadj_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      await insertJob({
        id: jobId,
        user_id: authUser.id,
        session_id: scope.sessionId,
        engine: 'meshy',
        prompt: String(body.prompt || ''),
        mode: 'text',
        status: 'pending',
        external_task_id: externalTaskId,
        workspace_id: scope.workspaceId,
        tenant_id: scope.tenantId,
        project_id: scope.projectId,
        scene_snapshot_id: scope.sceneSnapshotId,
        task_type: 'text-to-3d',
        credits_consumed: estimateTextTo3dPreviewCost(body),
        texture_data: textureDataWithMeshySource(
          {
            auto_refine: false,
            phase: 'preview',
            ...(body.register_cms_asset === false ? { register_cms_asset: false } : {}),
            ...(body.skip_glb_polish === true ? { skip_glb_polish: true } : {}),
          },
          meshyAuth.source === 'byok' ? 'byok' : 'platform',
        ),
      });

      return jsonResponse({
        job_id: jobId,
        task_id: externalTaskId,
        external_task_id: externalTaskId,
        phase: 'preview',
        status: 'pending',
        key_source: meshyAuth.source,
        workspace_id: scope.workspaceId,
      });
    }

    if (path === '/api/cad/meshy/text-to-3d/refine' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const previewTaskId = String(body.preview_task_id || body.previewTaskId || '').trim();
      if (!previewTaskId) return jsonResponse({ error: 'preview_task_id required' }, 400);

      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      if (isMeshyAuthMissing(meshyAuth)) {
        return jsonResponse({ stub: true, key_source: 'none', message: meshyStubMessage() });
      }

      try {
        await checkMeshyBalance(env, MESHY_CREDIT_COSTS.TEXT_TO_3D_REFINE, meshyAuth);
      } catch (e) {
        const mapped = meshyErrorResponseBody(e);
        return jsonResponse(mapped.body, mapped.status);
      }

      const scope = await resolveCadJobScope(env, authRequest, authUser, body);
      const { task_id: refineTaskId, raw } = await textTo3dRefine(env, {
        preview_task_id: previewTaskId,
        enable_pbr: body.enable_pbr !== false,
        texture_prompt: body.texture_prompt,
        texture_image_url: body.texture_image_url,
        ai_model: body.ai_model,
        target_formats: body.target_formats,
        remove_lighting: body.remove_lighting,
        moderation: body.moderation,
        auto_size: body.auto_size,
        origin_at: body.origin_at,
      }, meshyAuth);
      if (!refineTaskId) {
        return jsonResponse({ error: 'Meshy did not return refine task id', meshy: raw }, 502);
      }

      const jobId = 'cadj_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      await insertJob({
        id: jobId,
        user_id: authUser.id,
        session_id: scope.sessionId,
        engine: 'meshy',
        prompt: String(body.texture_prompt || body.prompt || ''),
        mode: 'text',
        status: 'pending',
        external_task_id: refineTaskId,
        parent_task_id: previewTaskId,
        workspace_id: scope.workspaceId,
        tenant_id: scope.tenantId,
        project_id: scope.projectId,
        scene_snapshot_id: scope.sceneSnapshotId,
        task_type: 'text-to-3d',
        credits_consumed: MESHY_CREDIT_COSTS.TEXT_TO_3D_REFINE,
        texture_data: textureDataWithMeshySource(null, meshyAuth.source === 'byok' ? 'byok' : 'platform'),
      });

      return jsonResponse({
        job_id: jobId,
        task_id: refineTaskId,
        external_task_id: refineTaskId,
        preview_task_id: previewTaskId,
        phase: 'refine',
        status: 'pending',
        workspace_id: scope.workspaceId,
      });
    }

    const taskOneMatch = url.pathname.match(/^\/api\/cad\/meshy\/task\/([^/]+)$/i);
    if (taskOneMatch) {
      const taskId = taskOneMatch[1];
      const taskType = url.searchParams.get('type') || 'text-to-3d';

      if (method === 'GET') {
        const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
        if (isMeshyAuthMissing(meshyAuth)) {
          return jsonResponse({ stub: true, task_id: taskId });
        }
        const task = await getMeshyTask(env, taskType, taskId, meshyAuth);
        const applied = await applyMeshyTaskToCadJob(env, ctx, task);
        return jsonResponse({ task, cad: applied });
      }

      if (method === 'DELETE') {
        const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
        if (isMeshyAuthMissing(meshyAuth)) {
          return jsonResponse({ ok: true, stub: true, task_id: taskId });
        }
        const deleted = await deleteMeshyTask(env, taskType, taskId, meshyAuth);
        return jsonResponse({ ok: true, task_id: taskId, meshy: deleted });
      }
    }

    if (path === '/api/cad/meshy/tasks' && method === 'GET') {
      const taskType = url.searchParams.get('type') || 'text-to-3d';
      const pageNum = parseInt(url.searchParams.get('page_num') || '1', 10);
      const pageSize = Math.min(parseInt(url.searchParams.get('page_size') || '10', 10), 50);
      const sortBy = url.searchParams.get('sort_by') || '-created_at';

      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      if (isMeshyAuthMissing(meshyAuth)) {
        return jsonResponse({ stub: true, tasks: [], page_num: pageNum, page_size: pageSize });
      }

      const tasks = await listMeshyTasks(env, taskType, {
        page_num: pageNum,
        page_size: pageSize,
        sort_by: sortBy,
      }, meshyAuth);
      return jsonResponse({ tasks, page_num: pageNum, page_size: pageSize, type: taskType });
    }

    if (path === '/api/cad/meshy/rigging' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      let built;
      try {
        built = buildMeshyRiggingPayload(body);
      } catch (e) {
        return jsonResponse({ error: String(e?.message || e) }, 400);
      }

      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      if (isMeshyAuthMissing(meshyAuth)) {
        return jsonResponse({ stub: true, key_source: 'none', message: meshyStubMessage() });
      }

      try {
        await checkMeshyBalanceForOperation(env, 'rigging', body, meshyAuth);
      } catch (e) {
        const mapped = meshyErrorResponseBody(e);
        return jsonResponse(mapped.body, mapped.status);
      }

      const scope = await resolveCadJobScope(env, authRequest, authUser, body);
      const { task_id: externalTaskId, raw } = await createMeshyTask(
        env,
        'rigging',
        built.payload,
        meshyAuth,
      );
      if (!externalTaskId) {
        return jsonResponse({ error: 'Meshy did not return rigging task id', meshy: raw }, 502);
      }

      const jobId = 'cadj_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      await insertJob({
        id: jobId,
        user_id: authUser.id,
        session_id: scope.sessionId,
        engine: 'meshy',
        prompt: built.inputTaskId ? `rig:${built.inputTaskId.slice(0, 12)}` : 'rig:model_url',
        mode: 'rig',
        status: 'pending',
        external_task_id: externalTaskId,
        parent_task_id: built.inputTaskId || null,
        workspace_id: scope.workspaceId,
        tenant_id: scope.tenantId,
        project_id: scope.projectId,
        scene_snapshot_id: scope.sceneSnapshotId,
        task_type: 'rigging',
        credits_consumed: MESHY_CREDIT_COSTS.RIGGING,
        texture_data: textureDataWithMeshySource(null, meshyAuth.source === 'byok' ? 'byok' : 'platform'),
      });

      return jsonResponse({
        job_id: jobId,
        task_id: externalTaskId,
        external_task_id: externalTaskId,
        result: externalTaskId,
        status: 'pending',
        phase: 'rigging',
        workspace_id: scope.workspaceId,
        key_source: meshyAuth.source,
        humanoid_warning:
          'Rigging works best on textured humanoid GLB models (face toward +Z for model_url).',
        face_count_warning:
          built.inputTaskId
            ? 'input_task_id models with more than 300,000 faces are not supported — remesh first.'
            : undefined,
      });
    }

    const rigStreamMatch = url.pathname.match(/^\/api\/cad\/meshy\/rigging\/([^/]+)\/stream$/i);
    if (rigStreamMatch && method === 'GET') {
      const taskId = rigStreamMatch[1];
      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      if (isMeshyAuthMissing(meshyAuth)) {
        return jsonResponse({ stub: true, task_id: taskId, message: meshyStubMessage() });
      }
      try {
        const upstream = await streamMeshyTask(env, 'rigging', taskId, meshyAuth);
        return new Response(upstream.body, {
          status: upstream.status,
          headers: {
            'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (e) {
        const mapped = meshyErrorResponseBody(e);
        return jsonResponse(mapped.body, mapped.status);
      }
    }

    const rigOneMatch = url.pathname.match(/^\/api\/cad\/meshy\/rigging\/([^/]+)$/i);
    if (rigOneMatch) {
      const taskId = rigOneMatch[1];
      if (method === 'GET') {
        const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
        if (isMeshyAuthMissing(meshyAuth)) {
          return jsonResponse({ stub: true, task_id: taskId });
        }
        const task = await getMeshyTask(env, 'rigging', taskId, meshyAuth);
        const applied = await applyMeshyTaskToCadJob(env, ctx, task);
        return jsonResponse({ task, cad: applied });
      }

      if (method === 'DELETE') {
        const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
        if (isMeshyAuthMissing(meshyAuth)) {
          return jsonResponse({ ok: true, stub: true, task_id: taskId });
        }
        const deleted = await deleteMeshyTask(env, 'rigging', taskId, meshyAuth);
        return jsonResponse({ ok: true, task_id: taskId, meshy: deleted });
      }
    }

    const printMcStreamMatch = url.pathname.match(/^\/api\/cad\/meshy\/print-multi-color\/([^/]+)\/stream$/i);
    if (printMcStreamMatch && method === 'GET') {
      const taskId = printMcStreamMatch[1];
      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      if (isMeshyAuthMissing(meshyAuth)) {
        return jsonResponse({ stub: true, task_id: taskId, message: meshyStubMessage() });
      }
      try {
        const upstream = await streamMeshyTask(env, 'print-multi-color', taskId, meshyAuth);
        return new Response(upstream.body, {
          status: upstream.status,
          headers: {
            'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (e) {
        const mapped = meshyErrorResponseBody(e);
        return jsonResponse(mapped.body, mapped.status);
      }
    }

    const printMcOneMatch = url.pathname.match(/^\/api\/cad\/meshy\/print-multi-color\/([^/]+)$/i);
    if (printMcOneMatch) {
      const taskId = printMcOneMatch[1];
      if (method === 'GET') {
        const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
        if (isMeshyAuthMissing(meshyAuth)) {
          return jsonResponse({ stub: true, task_id: taskId });
        }
        const task = await getMeshyTask(env, 'print-multi-color', taskId, meshyAuth);
        const applied = await applyMeshyTaskToCadJob(env, ctx, task);
        return jsonResponse({ task, cad: applied });
      }

      if (method === 'DELETE') {
        const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
        if (isMeshyAuthMissing(meshyAuth)) {
          return jsonResponse({ ok: true, stub: true, task_id: taskId });
        }
        const deleted = await deleteMeshyTask(env, 'print-multi-color', taskId, meshyAuth);
        return jsonResponse({ ok: true, task_id: taskId, meshy: deleted });
      }
    }

    if (path === '/api/cad/meshy/print-multi-color' && method === 'GET') {
      const pageNum = parseInt(url.searchParams.get('page_num') || '1', 10);
      const pageSize = Math.min(parseInt(url.searchParams.get('page_size') || '10', 10), 50);
      const sortBy = url.searchParams.get('sort_by') || '-created_at';

      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      if (isMeshyAuthMissing(meshyAuth)) {
        return jsonResponse({ stub: true, tasks: [], page_num: pageNum, page_size: pageSize });
      }

      const tasks = await listMeshyTasks(
        env,
        'print-multi-color',
        { page_num: pageNum, page_size: pageSize, sort_by: sortBy },
        meshyAuth,
      );
      return jsonResponse({ tasks, page_num: pageNum, page_size: pageSize, type: 'print-multi-color' });
    }

    if (path === '/api/cad/meshy/print-multi-color' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      let built;
      try {
        built = buildMeshyPrintMultiColorPayload(body);
      } catch (e) {
        return jsonResponse({ error: String(e?.message || e) }, 400);
      }

      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      if (isMeshyAuthMissing(meshyAuth)) {
        return jsonResponse({ stub: true, key_source: 'none', message: meshyStubMessage() });
      }

      try {
        await checkMeshyBalanceForOperation(env, 'print-multi-color', body, meshyAuth);
      } catch (e) {
        const mapped = meshyErrorResponseBody(e);
        return jsonResponse(mapped.body, mapped.status);
      }

      const scope = await resolveCadJobScope(env, authRequest, authUser, body);
      const { task_id: externalTaskId, raw } = await createMeshyTask(
        env,
        'print-multi-color',
        built.payload,
        meshyAuth,
      );
      if (!externalTaskId) {
        return jsonResponse({ error: 'Meshy did not return print-multi-color task id', meshy: raw }, 502);
      }

      const jobId = 'cadj_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      await insertJob({
        id: jobId,
        user_id: authUser.id,
        session_id: scope.sessionId,
        engine: 'meshy',
        prompt: built.inputTaskId ? `print-3mf:${built.inputTaskId.slice(0, 8)}` : 'print-3mf',
        mode: 'print-multi-color',
        status: 'pending',
        external_task_id: externalTaskId,
        parent_task_id: built.inputTaskId || null,
        workspace_id: scope.workspaceId,
        tenant_id: scope.tenantId,
        project_id: scope.projectId,
        scene_snapshot_id: scope.sceneSnapshotId,
        task_type: 'print-multi-color',
        credits_consumed: MESHY_CREDIT_COSTS.PRINT_MULTI_COLOR,
        texture_data: textureDataWithMeshySource(body.texture_data, meshyAuth.source === 'byok' ? 'byok' : 'platform'),
      });

      return jsonResponse({
        job_id: jobId,
        task_id: externalTaskId,
        external_task_id: externalTaskId,
        result: externalTaskId,
        status: 'pending',
        phase: 'print-multi-color',
        workspace_id: scope.workspaceId,
        key_source: meshyAuth.source,
        input_task_warning:
          'input_task_id must be a SUCCEEDED Meshy task. model_url supports textured .glb and .fbx.',
      });
    }

    const retextureStreamMatch = url.pathname.match(/^\/api\/cad\/meshy\/retexture\/([^/]+)\/stream$/i);
    if (retextureStreamMatch && method === 'GET') {
      const taskId = retextureStreamMatch[1];
      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      if (isMeshyAuthMissing(meshyAuth)) {
        return jsonResponse({ stub: true, task_id: taskId, message: meshyStubMessage() });
      }
      try {
        const upstream = await streamMeshyTask(env, 'retexture', taskId, meshyAuth);
        return new Response(upstream.body, {
          status: upstream.status,
          headers: {
            'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (e) {
        const mapped = meshyErrorResponseBody(e);
        return jsonResponse(mapped.body, mapped.status);
      }
    }

    const retextureOneMatch = url.pathname.match(/^\/api\/cad\/meshy\/retexture\/([^/]+)$/i);
    if (retextureOneMatch) {
      const taskId = retextureOneMatch[1];
      if (method === 'GET') {
        const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
        if (isMeshyAuthMissing(meshyAuth)) {
          return jsonResponse({ stub: true, task_id: taskId });
        }
        const task = await getMeshyTask(env, 'retexture', taskId, meshyAuth);
        const applied = await applyMeshyTaskToCadJob(env, ctx, task);
        return jsonResponse({ task, cad: applied });
      }

      if (method === 'DELETE') {
        const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
        if (isMeshyAuthMissing(meshyAuth)) {
          return jsonResponse({ ok: true, stub: true, task_id: taskId });
        }
        const deleted = await deleteMeshyTask(env, 'retexture', taskId, meshyAuth);
        return jsonResponse({ ok: true, task_id: taskId, meshy: deleted });
      }
    }

    if (path === '/api/cad/meshy/retexture' && method === 'GET') {
      const pageNum = parseInt(url.searchParams.get('page_num') || '1', 10);
      const pageSize = Math.min(parseInt(url.searchParams.get('page_size') || '10', 10), 50);
      const sortBy = url.searchParams.get('sort_by') || '-created_at';

      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      if (isMeshyAuthMissing(meshyAuth)) {
        return jsonResponse({ stub: true, tasks: [], page_num: pageNum, page_size: pageSize });
      }

      const tasks = await listMeshyTasks(
        env,
        'retexture',
        { page_num: pageNum, page_size: pageSize, sort_by: sortBy },
        meshyAuth,
      );
      return jsonResponse({ tasks, page_num: pageNum, page_size: pageSize, type: 'retexture' });
    }

    if (path === '/api/cad/meshy/retexture' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      let built;
      try {
        built = buildMeshyRetexturePayload(body);
      } catch (e) {
        return jsonResponse({ error: String(e?.message || e) }, 400);
      }

      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      if (isMeshyAuthMissing(meshyAuth)) {
        return jsonResponse({ stub: true, key_source: 'none', message: meshyStubMessage() });
      }

      try {
        await checkMeshyBalanceForOperation(env, 'retexture', body, meshyAuth);
      } catch (e) {
        const mapped = meshyErrorResponseBody(e);
        return jsonResponse(mapped.body, mapped.status);
      }

      const scope = await resolveCadJobScope(env, authRequest, authUser, body);
      const { task_id: externalTaskId, raw } = await createMeshyTask(
        env,
        'retexture',
        built.payload,
        meshyAuth,
      );
      if (!externalTaskId) {
        return jsonResponse({ error: 'Meshy did not return retexture task id', meshy: raw }, 502);
      }

      const jobId = 'cadj_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      const promptLabel =
        built.textStyle ||
        (built.imageStyle ? 'retexture:image' : '') ||
        (built.inputTaskId ? `retexture:${built.inputTaskId.slice(0, 8)}` : 'retexture');

      await insertJob({
        id: jobId,
        user_id: authUser.id,
        session_id: scope.sessionId,
        engine: 'meshy',
        prompt: promptLabel,
        mode: 'retexture',
        status: 'pending',
        external_task_id: externalTaskId,
        parent_task_id: built.inputTaskId || null,
        workspace_id: scope.workspaceId,
        tenant_id: scope.tenantId,
        project_id: scope.projectId,
        scene_snapshot_id: scope.sceneSnapshotId,
        task_type: 'retexture',
        credits_consumed: MESHY_CREDIT_COSTS.RETEXTURE,
        texture_data: textureDataWithMeshySource(body.texture_data, meshyAuth.source === 'byok' ? 'byok' : 'platform'),
      });

      return jsonResponse({
        job_id: jobId,
        task_id: externalTaskId,
        external_task_id: externalTaskId,
        result: externalTaskId,
        status: 'pending',
        phase: 'retexture',
        workspace_id: scope.workspaceId,
        key_source: meshyAuth.source,
        input_task_warning:
          'input_task_id must be a SUCCEEDED Text-to-3D Preview, Refine, Image-to-3D, or Remesh task.',
      });
    }

    if (path === '/api/cad/meshy/uv-unwrap' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const inputTaskId = String(body.input_task_id || body.model_task_id || '').trim();
      const modelUrl = String(body.model_url || '').trim();
      if (!inputTaskId && !modelUrl) {
        return jsonResponse({ error: 'input_task_id or model_url required' }, 400);
      }

      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      if (isMeshyAuthMissing(meshyAuth)) {
        return jsonResponse({ stub: true, key_source: 'none', message: meshyStubMessage() });
      }

      try {
        await checkMeshyBalanceForOperation(env, 'uv-unwrap', body, meshyAuth);
      } catch (e) {
        const mapped = meshyErrorResponseBody(e);
        return jsonResponse(mapped.body, mapped.status);
      }

      try {
        const result = await startJob(authRequest, authUser, body, 'uv-unwrap', meshyAuth);
        return jsonResponse({
          ...result,
          key_source: meshyAuth.source,
          face_count_warning: 'Meshy UV unwrap supports models up to 40,000 faces (5 credits).',
          docs: 'https://docs.meshy.ai/en/api/uv-unwrap',
        });
      } catch (e) {
        const mapped = meshyErrorResponseBody(e);
        if (mapped.status !== 500) return jsonResponse(mapped.body, mapped.status);
        return jsonResponse({ error: String(e?.message || e) }, 400);
      }
    }

    if (path === '/api/cad/meshy/remesh' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      if (isMeshyAuthMissing(meshyAuth)) {
        return jsonResponse({ stub: true, key_source: 'none', message: meshyStubMessage() });
      }
      try {
        const result = await startJob(authRequest, authUser, body, 'remesh', meshyAuth);
        return jsonResponse({
          ...result,
          key_source: meshyAuth.source,
          docs: 'https://docs.meshy.ai/en/api/remesh',
          note: 'For format-only or size-only jobs prefer /api/cad/meshy/convert and /api/cad/meshy/resize.',
        });
      } catch (e) {
        const mapped = meshyErrorResponseBody(e);
        if (mapped.status !== 500) return jsonResponse(mapped.body, mapped.status);
        return jsonResponse({ error: String(e?.message || e) }, 400);
      }
    }

    if (path === '/api/cad/meshy/convert' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      if (isMeshyAuthMissing(meshyAuth)) {
        return jsonResponse({ stub: true, key_source: 'none', message: meshyStubMessage() });
      }
      try {
        const result = await startJob(authRequest, authUser, body, 'convert', meshyAuth);
        return jsonResponse({
          ...result,
          key_source: meshyAuth.source,
          docs: 'https://docs.meshy.ai/en/api/convert',
        });
      } catch (e) {
        const mapped = meshyErrorResponseBody(e);
        if (mapped.status !== 500) return jsonResponse(mapped.body, mapped.status);
        return jsonResponse({ error: String(e?.message || e) }, 400);
      }
    }

    if (path === '/api/cad/meshy/resize' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      if (isMeshyAuthMissing(meshyAuth)) {
        return jsonResponse({ stub: true, key_source: 'none', message: meshyStubMessage() });
      }
      try {
        const result = await startJob(authRequest, authUser, body, 'resize', meshyAuth);
        return jsonResponse({
          ...result,
          key_source: meshyAuth.source,
          docs: 'https://docs.meshy.ai/en/api/resize',
        });
      } catch (e) {
        const mapped = meshyErrorResponseBody(e);
        if (mapped.status !== 500) return jsonResponse(mapped.body, mapped.status);
        return jsonResponse({ error: String(e?.message || e) }, 400);
      }
    }

    const img3dStreamMatch = url.pathname.match(/^\/api\/cad\/meshy\/image-to-3d\/([^/]+)\/stream$/i);
    if (img3dStreamMatch && method === 'GET') {
      const taskId = img3dStreamMatch[1];
      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      if (isMeshyAuthMissing(meshyAuth)) {
        return jsonResponse({ stub: true, task_id: taskId, message: meshyStubMessage() });
      }
      try {
        const upstream = await streamMeshyTask(env, 'image-to-3d', taskId, meshyAuth);
        return new Response(upstream.body, {
          status: upstream.status,
          headers: {
            'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (e) {
        const mapped = meshyErrorResponseBody(e);
        return jsonResponse(mapped.body, mapped.status);
      }
    }

    const img3dOneMatch = url.pathname.match(/^\/api\/cad\/meshy\/image-to-3d\/([^/]+)$/i);
    if (img3dOneMatch) {
      const taskId = img3dOneMatch[1];
      if (method === 'GET') {
        const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
        if (isMeshyAuthMissing(meshyAuth)) {
          return jsonResponse({ stub: true, task_id: taskId });
        }
        const task = await getMeshyTask(env, 'image-to-3d', taskId, meshyAuth);
        const applied = await applyMeshyTaskToCadJob(env, ctx, task);
        return jsonResponse({ task, cad: applied });
      }

      if (method === 'DELETE') {
        const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
        if (isMeshyAuthMissing(meshyAuth)) {
          return jsonResponse({ ok: true, stub: true, task_id: taskId });
        }
        const deleted = await deleteMeshyTask(env, 'image-to-3d', taskId, meshyAuth);
        return jsonResponse({ ok: true, task_id: taskId, meshy: deleted });
      }
    }

    if (path === '/api/cad/meshy/image-to-3d' && method === 'GET') {
      const pageNum = parseInt(url.searchParams.get('page_num') || '1', 10);
      const pageSize = Math.min(parseInt(url.searchParams.get('page_size') || '10', 10), 50);
      const sortBy = url.searchParams.get('sort_by') || '-created_at';

      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      if (isMeshyAuthMissing(meshyAuth)) {
        return jsonResponse({ stub: true, tasks: [], page_num: pageNum, page_size: pageSize });
      }

      const tasks = await listMeshyTasks(
        env,
        'image-to-3d',
        { page_num: pageNum, page_size: pageSize, sort_by: sortBy },
        meshyAuth,
      );
      return jsonResponse({ tasks, page_num: pageNum, page_size: pageSize, type: 'image-to-3d' });
    }

    if (path === '/api/cad/meshy/image-to-3d' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      let built;
      try {
        built = buildMeshyImageTo3dPayload(body);
      } catch (e) {
        return jsonResponse({ error: String(e?.message || e) }, 400);
      }

      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      if (isMeshyAuthMissing(meshyAuth)) {
        return jsonResponse({ stub: true, key_source: 'none', message: meshyStubMessage() });
      }

      try {
        await checkMeshyBalanceForOperation(env, 'image-to-3d', body, meshyAuth);
      } catch (e) {
        const mapped = meshyErrorResponseBody(e);
        return jsonResponse(mapped.body, mapped.status);
      }

      const scope = await resolveCadJobScope(env, authRequest, authUser, body);
      const { task_id: externalTaskId, raw } = await createMeshyTask(
        env,
        'image-to-3d',
        built.payload,
        meshyAuth,
      );
      if (!externalTaskId) {
        return jsonResponse({ error: 'Meshy did not return image-to-3d task id', meshy: raw }, 502);
      }

      const jobId = 'cadj_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      const promptLabel =
        String(body.texture_prompt || body.prompt || '').trim() ||
        (built.inputTaskId ? `image-to-3d:${built.inputTaskId.slice(0, 8)}` : 'image-to-3d');

      await insertJob({
        id: jobId,
        user_id: authUser.id,
        session_id: scope.sessionId,
        engine: 'meshy',
        prompt: promptLabel,
        mode: 'image',
        status: 'pending',
        external_task_id: externalTaskId,
        parent_task_id: built.inputTaskId || null,
        workspace_id: scope.workspaceId,
        tenant_id: scope.tenantId,
        project_id: scope.projectId,
        scene_snapshot_id: scope.sceneSnapshotId,
        task_type: 'image-to-3d',
        credits_consumed: estimateImageTo3dCost(body),
        texture_data: textureDataWithMeshySource(
          built.payload.texture_prompt ? { texture_prompt: built.payload.texture_prompt } : null,
          meshyAuth.source === 'byok' ? 'byok' : 'platform',
        ),
      });

      return jsonResponse({
        job_id: jobId,
        task_id: externalTaskId,
        external_task_id: externalTaskId,
        result: externalTaskId,
        status: 'pending',
        phase: 'image-to-3d',
        workspace_id: scope.workspaceId,
        key_source: meshyAuth.source,
      });
    }

    const animStreamMatch = url.pathname.match(/^\/api\/cad\/meshy\/animations\/([^/]+)\/stream$/i);
    if (animStreamMatch && method === 'GET') {
      const taskId = animStreamMatch[1];
      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      if (isMeshyAuthMissing(meshyAuth)) {
        return jsonResponse({ stub: true, task_id: taskId, message: meshyStubMessage() });
      }
      try {
        const upstream = await streamMeshyTask(env, 'animation', taskId, meshyAuth);
        return new Response(upstream.body, {
          status: upstream.status,
          headers: {
            'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (e) {
        const mapped = meshyErrorResponseBody(e);
        return jsonResponse(mapped.body, mapped.status);
      }
    }

    const animOneMatch = url.pathname.match(/^\/api\/cad\/meshy\/animations\/([^/]+)$/i);
    if (animOneMatch) {
      const taskId = animOneMatch[1];
      if (taskId.toLowerCase() !== 'library') {
        if (method === 'GET') {
          const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
          if (isMeshyAuthMissing(meshyAuth)) {
            return jsonResponse({ stub: true, task_id: taskId });
          }
          const task = await getMeshyTask(env, 'animation', taskId, meshyAuth);
          const applied = await applyMeshyTaskToCadJob(env, ctx, task);
          return jsonResponse({ task, cad: applied });
        }

        if (method === 'DELETE') {
          const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
          if (isMeshyAuthMissing(meshyAuth)) {
            return jsonResponse({ ok: true, stub: true, task_id: taskId });
          }
          const deleted = await deleteMeshyTask(env, 'animation', taskId, meshyAuth);
          return jsonResponse({ ok: true, task_id: taskId, meshy: deleted });
        }
      }
    }

    if (path === '/api/cad/meshy/animations' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      let built;
      try {
        built = buildMeshyAnimationPayload(body);
      } catch (e) {
        return jsonResponse({ error: String(e?.message || e) }, 400);
      }

      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      if (isMeshyAuthMissing(meshyAuth)) {
        return jsonResponse({ stub: true, key_source: 'none', message: meshyStubMessage() });
      }

      try {
        await checkMeshyBalanceForOperation(env, 'animation', body, meshyAuth);
      } catch (e) {
        const mapped = meshyErrorResponseBody(e);
        return jsonResponse(mapped.body, mapped.status);
      }

      const scope = await resolveCadJobScope(env, authRequest, authUser, body);
      const { task_id: externalTaskId, raw } = await createMeshyTask(
        env,
        'animation',
        built.payload,
        meshyAuth,
      );
      if (!externalTaskId) {
        return jsonResponse({ error: 'Meshy did not return animation task id', meshy: raw }, 502);
      }

      const jobId = 'cadj_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      await insertJob({
        id: jobId,
        user_id: authUser.id,
        session_id: scope.sessionId,
        engine: 'meshy',
        prompt: `animate:${built.actionId}`,
        mode: 'animation',
        status: 'pending',
        external_task_id: externalTaskId,
        parent_task_id: built.rigTaskId,
        workspace_id: scope.workspaceId,
        tenant_id: scope.tenantId,
        project_id: scope.projectId,
        scene_snapshot_id: scope.sceneSnapshotId,
        task_type: 'animation',
        rig_task_id: built.rigTaskId,
        credits_consumed: MESHY_CREDIT_COSTS.ANIMATION,
        texture_data: textureDataWithMeshySource(
          {
            action_id: built.actionId,
            ...(body.post_process ? { post_process: built.payload.post_process } : {}),
          },
          meshyAuth.source === 'byok' ? 'byok' : 'platform',
        ),
      });

      return jsonResponse({
        job_id: jobId,
        task_id: externalTaskId,
        external_task_id: externalTaskId,
        result: externalTaskId,
        status: 'pending',
        phase: 'animation',
        action_id: built.actionId,
        rig_task_id: built.rigTaskId,
        workspace_id: scope.workspaceId,
        key_source: meshyAuth.source,
      });
    }

    if (path === '/api/cad/meshy/animations/packs' && method === 'GET') {
      const rigTaskId = String(url.searchParams.get('rig_task_id') || '').trim();
      if (!rigTaskId) return jsonResponse({ error: 'rig_task_id required' }, 400);

      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      let basicAnimations = null;
      let meshyTask = null;
      if (!isMeshyAuthMissing(meshyAuth)) {
        try {
          meshyTask = await getMeshyTask(env, 'rigging', rigTaskId, meshyAuth);
          const basic = meshyTask?.result?.basic_animations;
          if (basic && typeof basic === 'object') basicAnimations = basic;
          if (ctx) {
            try {
              await applyMeshyTaskToCadJob(env, ctx, meshyTask);
            } catch {
              /* best-effort sync */
            }
          }
        } catch {
          /* packs still return from D1 */
        }
      }

      let jobRows = [];
      if (env.DB) {
        try {
          const { results } = await env.DB.prepare(
            `SELECT id, prompt, status, result_url, r2_key, r2_bucket, task_type, model_formats,
                    texture_data, external_task_id, parent_task_id, rig_task_id, created_at
             FROM agentsam_cad_jobs
             WHERE user_id = ? AND engine = 'meshy'
               AND (
                 (task_type = 'rigging' AND external_task_id = ?)
                 OR (task_type = 'animation' AND (rig_task_id = ? OR parent_task_id = ?))
               )
             ORDER BY created_at DESC
             LIMIT 50`,
          )
            .bind(authUser.id, rigTaskId, rigTaskId, rigTaskId)
            .all();
          jobRows = (results || []).map((row) => {
            let model_formats = null;
            let texture_data = null;
            try {
              model_formats = row.model_formats ? JSON.parse(String(row.model_formats)) : null;
            } catch {
              model_formats = null;
            }
            try {
              texture_data = row.texture_data ? JSON.parse(String(row.texture_data)) : null;
            } catch {
              texture_data = null;
            }
            return {
              ...row,
              model_formats,
              texture_data,
              public_url:
                row.r2_key && !String(row.r2_key).startsWith('b64:')
                  ? buildCadAssetPublicUrl(row.r2_key)
                  : null,
            };
          });
        } catch (e) {
          return jsonResponse({ error: String(e?.message || e) }, 500);
        }
      }

      const packsByAction = new Map();
      const BASIC_IDS = { walking: 92, running: 93 };

      const upsert = (pack) => {
        const id = Number(pack.action_id);
        if (!Number.isFinite(id)) return;
        const prev = packsByAction.get(id);
        if (!prev) {
          packsByAction.set(id, pack);
          return;
        }
        packsByAction.set(id, {
          ...prev,
          ...pack,
          name: pack.name || prev.name,
          glb_url: pack.glb_url || prev.glb_url,
          ready: Boolean(pack.glb_url || prev.glb_url || pack.ready || prev.ready),
          job_id: pack.job_id || prev.job_id,
        });
      };

      if (basicAnimations) {
        for (const [key, actionId] of Object.entries(BASIC_IDS)) {
          const glb =
            (typeof basicAnimations[`${key}_glb_url`] === 'string' &&
              basicAnimations[`${key}_glb_url`]) ||
            (typeof basicAnimations[`${key}_armature_glb_url`] === 'string' &&
              basicAnimations[`${key}_armature_glb_url`]) ||
            null;
          if (!glb && basicAnimations[`${key}_glb_url`] == null) continue;
          upsert({
            action_id: actionId,
            name: key === 'walking' ? 'Walking' : 'Running',
            category: 'basic',
            glb_url: glb,
            ready: Boolean(glb),
            source: 'meshy_rig',
          });
        }
      }

      for (const job of jobRows) {
        const taskType = String(job.task_type || '').toLowerCase();
        const formats =
          job.model_formats && typeof job.model_formats === 'object' ? job.model_formats : {};
        const done = /^(done|complete|succeed)/i.test(String(job.status || ''));

        if (taskType === 'rigging' && done) {
          for (const [key, actionId] of Object.entries(BASIC_IDS)) {
            const glb =
              (typeof formats[`${key}_glb_url`] === 'string' && formats[`${key}_glb_url`]) ||
              (typeof formats[`${key}_armature_glb_url`] === 'string' &&
                formats[`${key}_armature_glb_url`]) ||
              null;
            if (!glb) continue;
            upsert({
              action_id: actionId,
              name: key === 'walking' ? 'Walking' : 'Running',
              category: 'basic',
              glb_url: glb,
              ready: true,
              job_id: job.id,
              source: 'cad_job',
            });
          }
        }

        if (taskType === 'animation' && done) {
          let actionId = null;
          const td = job.texture_data;
          if (td && typeof td === 'object' && td.action_id != null) {
            actionId = Number(td.action_id);
          }
          if (!Number.isFinite(actionId)) {
            const m = String(job.prompt || '').match(/animate:(\d+)/i);
            actionId = m ? Number(m[1]) : null;
          }
          if (!Number.isFinite(actionId)) continue;
          const glb =
            (typeof formats.animation_glb_url === 'string' && formats.animation_glb_url) ||
            job.public_url ||
            job.result_url ||
            null;
          upsert({
            action_id: actionId,
            name: `Clip ${actionId}`,
            category: 'applied',
            glb_url: glb,
            ready: Boolean(glb),
            job_id: job.id,
            source: 'cad_job',
          });
        }
      }

      return jsonResponse({
        rig_task_id: rigTaskId,
        packs: Array.from(packsByAction.values()).sort((a, b) => {
          if (Boolean(a.ready) !== Boolean(b.ready)) return a.ready ? -1 : 1;
          return String(a.name).localeCompare(String(b.name));
        }),
        jobs: jobRows.length,
        meshy_synced: Boolean(meshyTask),
        key_source: meshyAuth?.source || 'none',
      });
    }

    if (path === '/api/cad/meshy/animations/library' && method === 'GET') {
      try {
        const res = await fetch('https://api.meshy.ai/web/public/animations/resources', {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) return jsonResponse({ error: 'animation_library_unavailable' }, 502);
        const data = await res.json();
        return jsonResponse({ animations: data });
      } catch (e) {
        return jsonResponse({ error: String(e?.message || e) }, 502);
      }
    }

    if (path === '/api/cad/meshy/task' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const taskType = String(body.task_type || '').trim();
      if (!taskType) return jsonResponse({ error: 'task_type required' }, 400);

      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      if (isMeshyAuthMissing(meshyAuth)) {
        const scope = await resolveCadJobScope(env, authRequest, authUser, body);
        const jobId = 'cadj_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
        await insertJob({
          id: jobId,
          user_id: authUser.id,
          session_id: scope.sessionId,
          engine: 'meshy',
          prompt: String(body.prompt || taskType),
          mode: taskType,
          status: 'stub',
          workspace_id: scope.workspaceId,
          tenant_id: scope.tenantId,
          project_id: scope.projectId,
          scene_snapshot_id: scope.sceneSnapshotId,
          task_type: MESHY_TASK_TYPE_ALIASES[taskType] || taskType,
        });
        return jsonResponse({
          job_id: jobId,
          status: 'stub',
          key_source: 'none',
          message: meshyStubMessage(),
        });
      }

      try {
        const result = await startJob(authRequest, authUser, body, taskType, meshyAuth);
        return jsonResponse({ ...result, key_source: meshyAuth.source });
      } catch (e) {
        const mapped = meshyErrorResponseBody(e);
        if (mapped.status !== 500) return jsonResponse(mapped.body, mapped.status);
        return jsonResponse({ error: String(e?.message || e) }, 400);
      }
    }

    if (path === '/api/cad/meshy/generate' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const { prompt, mode = 'text', image_url, auto_refine = true } = body;
      if (!prompt && mode === 'text') return jsonResponse({ error: 'prompt required' }, 400);
      if (mode === 'image' && !image_url) {
        return jsonResponse({ error: 'image_url required for image mode' }, 400);
      }

      const scope = await resolveCadJobScope(env, authRequest, authUser, body);
      const jobId = 'cadj_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
      logMeshyAuthResolution(reqCtx, meshyAuth, env);

      if (isMeshyAuthMissing(meshyAuth)) {
        await insertJob({
          id: jobId,
          user_id: authUser.id,
          session_id: scope.sessionId,
          engine: 'meshy',
          prompt: prompt || '',
          mode,
          status: 'stub',
          workspace_id: scope.workspaceId,
          tenant_id: scope.tenantId,
          project_id: scope.projectId,
          scene_snapshot_id: scope.sceneSnapshotId,
          task_type: mode === 'image' ? 'image-to-3d' : 'text-to-3d',
        });
        return jsonResponse({
          job_id: jobId,
          status: 'stub',
          key_source: 'none',
          message: meshyStubMessage(),
        });
      }

      try {
        const op = mode === 'image' ? 'image-to-3d' : 'text-to-3d';
        await checkMeshyBalanceForOperation(env, op, body, meshyAuth);
      } catch (e) {
        const mapped = meshyErrorResponseBody(e);
        return jsonResponse(mapped.body, mapped.status);
      }

      let externalTaskId = null;
      let taskType = 'text-to-3d';
      let creditsConsumed = 0;
      let phase = 'preview';

      if (mode === 'image') {
        taskType = 'image-to-3d';
        phase = 'image-to-3d';
        let imgBuilt;
        try {
          imgBuilt = buildMeshyImageTo3dPayload({ ...body, image_url: image_url || body.image_url });
        } catch (e) {
          return jsonResponse({ error: String(e?.message || e) }, 400);
        }
        const created = await createMeshyTask(env, 'image-to-3d', imgBuilt.payload, meshyAuth);
        externalTaskId = created.task_id;
        creditsConsumed = estimateImageTo3dCost(body);
      } else {
        const trimmedPrompt = String(prompt || body.prompt || '').trim();
        /** @type {Record<string, unknown>} */
        const previewBody =
          body.mode === 'preview'
            ? { ...body, prompt: trimmedPrompt, mode: 'preview' }
            : {
                mode: 'preview',
                prompt: trimmedPrompt,
                ai_model: body.ai_model,
                model_type: body.model_type,
                topology: body.topology,
                target_polycount: body.target_polycount,
                decimation_mode: body.decimation_mode,
                should_remesh: body.should_remesh,
                pose_mode: body.pose_mode,
                target_formats: body.target_formats ?? ['glb'],
                moderation: body.moderation,
                auto_size: body.auto_size,
                origin_at: body.origin_at,
                alpha_thumbnail: body.alpha_thumbnail,
              };
        delete previewBody.auto_refine;
        const created = await textTo3dPreview(env, previewBody, meshyAuth);
        externalTaskId = created.task_id;
        creditsConsumed = estimateTextTo3dPreviewCost(previewBody);
        if (auto_refine !== false) {
          // Refine is chained asynchronously when preview succeeds (meshy-cad-sync).
          phase = 'preview→refine';
        } else {
          phase = 'preview';
        }
      }

      if (!externalTaskId) {
        return jsonResponse({ error: 'Meshy did not return task id' }, 502);
      }

      await insertJob({
        id: jobId,
        user_id: authUser.id,
        session_id: scope.sessionId,
        engine: 'meshy',
        prompt: prompt || '',
        mode,
        status: 'pending',
        external_task_id: externalTaskId,
        workspace_id: scope.workspaceId,
        tenant_id: scope.tenantId,
        project_id: scope.projectId,
        scene_snapshot_id: scope.sceneSnapshotId,
        task_type: taskType,
        credits_consumed: creditsConsumed,
        texture_data: textureDataWithMeshySource(
          mode === 'text' && auto_refine !== false ? { auto_refine: true } : null,
          meshyAuth.source === 'byok' ? 'byok' : 'platform',
        ),
      });

      return jsonResponse({
        job_id: jobId,
        status: 'pending',
        external_task_id: externalTaskId,
        phase,
        auto_refine: mode === 'text' ? auto_refine !== false : false,
        key_source: meshyAuth.source,
        estimated_full_cost: mode === 'text' ? estimateTextTo3dFullCost(body, { autoRefine: auto_refine !== false }) : creditsConsumed,
        workspace_id: scope.workspaceId,
      });
    }

    const statusMatch = url.pathname.match(/^\/api\/cad\/meshy\/status\/([^/]+)$/i);
    if (statusMatch && method === 'GET') {
      const jobId = statusMatch[1];
      const job = await env.DB.prepare(`SELECT * FROM agentsam_cad_jobs WHERE id = ? LIMIT 1`)
        .bind(jobId)
        .first();
      if (!job) return jsonResponse({ error: 'Job not found' }, 404);
      if (String(job.user_id) !== String(authUser.id)) {
        return jsonResponse({ error: 'Forbidden' }, 403);
      }

      if (['done', 'failed', 'stub'].includes(String(job.status))) {
        const publicUrl =
          job.r2_key && !String(job.r2_key).startsWith('b64:')
            ? buildCadAssetPublicUrl(job.r2_key)
            : job.result_url;
        return jsonResponse({
          job_id: jobId,
          status: job.status,
          result_url: job.result_url,
          public_url: publicUrl,
          r2_key: job.r2_key,
          error: job.error,
          progress_pct: job.progress_pct,
          task_type: job.task_type,
          parent_task_id: job.parent_task_id,
          model_formats: (() => {
            try {
              return job.model_formats ? JSON.parse(String(job.model_formats)) : null;
            } catch {
              return null;
            }
          })(),
          texture_data: (() => {
            try {
              return job.texture_data ? JSON.parse(String(job.texture_data)) : null;
            } catch {
              return null;
            }
          })(),
        });
      }

      const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx, job);
      if (isMeshyAuthMissing(meshyAuth)) {
        return jsonResponse({ job_id: jobId, status: 'stub', key_source: 'none' });
      }

      if (!job.external_task_id) {
        return jsonResponse({ job_id: jobId, status: job.status });
      }

      const taskType = String(job.task_type || (job.mode === 'image' ? 'image-to-3d' : 'text-to-3d'));
      const task = await getMeshyTask(env, taskType, String(job.external_task_id), meshyAuth);
      const applied = await applyMeshyTaskToCadJob(env, ctx, task);
      if (applied.ok && applied.status === 'failed') {
        return jsonResponse({
          job_id: jobId,
          status: 'failed',
          error: applied.error,
        });
      }
      if (applied.ok && applied.status === 'done') {
        const refreshed = await env.DB.prepare(`SELECT * FROM agentsam_cad_jobs WHERE id = ? LIMIT 1`)
          .bind(jobId)
          .first();
        return jsonResponse({
          job_id: jobId,
          status: 'done',
          result_url: applied.public_url,
          public_url: applied.public_url,
          r2_key: applied.r2_key,
          cms_asset: applied.cms_asset,
          progress_pct: 100,
          task_type: refreshed?.task_type ?? job.task_type,
          model_formats: (() => {
            try {
              return refreshed?.model_formats ? JSON.parse(String(refreshed.model_formats)) : null;
            } catch {
              return null;
            }
          })(),
          texture_data: (() => {
            try {
              return refreshed?.texture_data ? JSON.parse(String(refreshed.texture_data)) : null;
            } catch {
              return null;
            }
          })(),
        });
      }
      return jsonResponse({
        job_id: jobId,
        status: applied.status || job.status,
        progress: applied.progress,
        progress_pct: applied.progress ?? job.progress_pct ?? null,
        phase: applied.phase,
      });
    }

    return null;
  } catch (e) {
    const mapped = meshyErrorResponseBody(e);
    if (mapped.status !== 500) {
      return jsonResponse(mapped.body, mapped.status);
    }
    console.warn('[handleCadMeshyApi]', e?.message ?? e);
    return jsonResponse({ error: String(e?.message || e) }, 500);
  }
}

/**
 * In-process tool bridge — agent tools call without HTTP cookies.
 * @param {any} env
 * @param {any} ctx
 * @param {{ userId: string; tenantId?: string; workspaceId?: string }} auth
 * @param {Record<string, unknown>} body
 */
export async function meshyGenerateInProcess(env, ctx, auth, body = {}) {
  const fakeUrl = new URL('https://inneranimalmedia.com/api/cad/meshy/generate');
  const req = new Request(fakeUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': String(auth.userId),
      ...(auth.tenantId ? { 'X-Tenant-Id': String(auth.tenantId) } : {}),
      ...(auth.workspaceId ? { 'X-Workspace-Id': String(auth.workspaceId) } : {}),
    },
    body: JSON.stringify(body),
  });
  // resolveRequestContext reads session; for tools use internal headers via prime auth
  await primeRequestAuthForTool(req, env, auth);
  const res = await handleCadMeshyApi(req, fakeUrl, env, ctx);
  if (!res) return { error: 'meshy generate handler missing' };
  return res.json();
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{ userId: string; tenantId?: string; workspaceId?: string }} auth
 * @param {string} jobId
 */
export async function meshyStatusInProcess(env, ctx, auth, jobId) {
  const fakeUrl = new URL(`https://inneranimalmedia.com/api/cad/meshy/status/${encodeURIComponent(jobId)}`);
  const req = new Request(fakeUrl.toString(), {
    method: 'GET',
    headers: {
      'X-User-Id': String(auth.userId),
      ...(auth.tenantId ? { 'X-Tenant-Id': String(auth.tenantId) } : {}),
      ...(auth.workspaceId ? { 'X-Workspace-Id': String(auth.workspaceId) } : {}),
    },
  });
  await primeRequestAuthForTool(req, env, auth);
  const res = await handleCadMeshyApi(req, fakeUrl, env, ctx);
  if (!res) return { error: 'meshy status handler missing' };
  return res.json();
}

/**
 * In-process bridge for Meshy animation tasks (POST /openapi/v1/animations).
 * @param {any} env
 * @param {any} ctx
 * @param {{ userId: string; tenantId?: string; workspaceId?: string }} auth
 * @param {Record<string, unknown>} body
 */
export async function meshyAnimationInProcess(env, ctx, auth, body = {}) {
  const fakeUrl = new URL('https://inneranimalmedia.com/api/cad/meshy/animations');
  const req = new Request(fakeUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': String(auth.userId),
      ...(auth.tenantId ? { 'X-Tenant-Id': String(auth.tenantId) } : {}),
      ...(auth.workspaceId ? { 'X-Workspace-Id': String(auth.workspaceId) } : {}),
    },
    body: JSON.stringify(body),
  });
  await primeRequestAuthForTool(req, env, auth);
  const res = await handleCadMeshyApi(req, fakeUrl, env, ctx);
  if (!res) return { error: 'meshy animation handler missing' };
  return res.json();
}

/**
 * In-process bridge for Meshy image-to-3D tasks (POST /openapi/v1/image-to-3d).
 * @param {any} env
 * @param {any} ctx
 * @param {{ userId: string; tenantId?: string; workspaceId?: string }} auth
 * @param {Record<string, unknown>} body
 */
export async function meshyImageTo3dInProcess(env, ctx, auth, body = {}) {
  const fakeUrl = new URL('https://inneranimalmedia.com/api/cad/meshy/image-to-3d');
  const req = new Request(fakeUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': String(auth.userId),
      ...(auth.tenantId ? { 'X-Tenant-Id': String(auth.tenantId) } : {}),
      ...(auth.workspaceId ? { 'X-Workspace-Id': String(auth.workspaceId) } : {}),
    },
    body: JSON.stringify(body),
  });
  await primeRequestAuthForTool(req, env, auth);
  const res = await handleCadMeshyApi(req, fakeUrl, env, ctx);
  if (!res) return { error: 'meshy image-to-3d handler missing' };
  return res.json();
}

export async function meshyRefineInProcess(env, ctx, auth, body = {}) {
  const fakeUrl = new URL('https://inneranimalmedia.com/api/cad/meshy/text-to-3d/refine');
  const req = new Request(fakeUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': String(auth.userId),
      ...(auth.tenantId ? { 'X-Tenant-Id': String(auth.tenantId) } : {}),
      ...(auth.workspaceId ? { 'X-Workspace-Id': String(auth.workspaceId) } : {}),
    },
    body: JSON.stringify(body),
  });
  await primeRequestAuthForTool(req, env, auth);
  const res = await handleCadMeshyApi(req, fakeUrl, env, ctx);
  if (!res) return { error: 'meshy refine handler missing' };
  return res.json();
}

export async function meshyMultiImageTo3dInProcess(env, ctx, auth, body = {}) {
  const req = new Request('https://inneranimalmedia.com/api/cad/meshy/multi-image-to-3d', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': String(auth.userId),
      ...(auth.tenantId ? { 'X-Tenant-Id': String(auth.tenantId) } : {}),
      ...(auth.workspaceId ? { 'X-Workspace-Id': String(auth.workspaceId) } : {}),
    },
    body: JSON.stringify(body),
  });
  await primeRequestAuthForTool(req, env, auth);
  const authRequest = bridgedToolRequest(req);
  const reqCtx = await resolveRequestContext(authRequest, env);
  if (reqCtx.error) return { error: 'Unauthorized' };
  const meshyAuth = await resolveRequestMeshyAuth(env, reqCtx);
  return startMeshyCadJob(
    env,
    authRequest,
    { id: reqCtx.userId, tenant_id: reqCtx.tenantId },
    body,
    'multi-image-to-3d',
    meshyAuth,
    ctx,
  );
}

export async function meshyListOwnedTasksInProcess(env, auth, body = {}) {
  const limit = Math.min(Math.max(Number(body.limit) || 10, 1), 20);
  const rows = await env.DB.prepare(
    `SELECT id AS job_id, external_task_id AS task_id, task_type, status, progress_pct,
            prompt, model_formats, created_at, updated_at
     FROM agentsam_cad_jobs
     WHERE engine = 'meshy'
       AND user_id = ?
       AND (? = '' OR tenant_id = ?)
       AND (? = '' OR workspace_id = ?)
     ORDER BY updated_at DESC
     LIMIT ?`,
  )
    .bind(
      String(auth.userId),
      String(auth.tenantId || ''),
      String(auth.tenantId || ''),
      String(auth.workspaceId || ''),
      String(auth.workspaceId || ''),
      limit,
    )
    .all();
  return { tasks: rows.results || [], count: rows.results?.length || 0 };
}

export async function meshyDeleteOwnedTaskInProcess(env, auth, body = {}) {
  const jobId = String(body.job_id ?? body.id ?? '').trim();
  if (!jobId) return { error: 'job_id required' };
  const job = await env.DB.prepare(
    `SELECT id, user_id, tenant_id, workspace_id, task_type, external_task_id, texture_data
     FROM agentsam_cad_jobs
     WHERE id = ? AND engine = 'meshy' AND user_id = ?
       AND (? = '' OR tenant_id = ?)
       AND (? = '' OR workspace_id = ?)
     LIMIT 1`,
  )
    .bind(
      jobId,
      String(auth.userId),
      String(auth.tenantId || ''),
      String(auth.tenantId || ''),
      String(auth.workspaceId || ''),
      String(auth.workspaceId || ''),
    )
    .first();
  if (!job) return { error: 'owned Meshy task not found' };

  const meshyAuth = await resolveMeshyAuth(
    env,
    { userId: auth.userId, tenant_id: auth.tenantId },
    { keySource: meshyKeySourceFromJob(job) },
  );
  if (isMeshyAuthMissing(meshyAuth)) return { error: meshyStubMessage() };
  const deleted = await deleteMeshyTask(
    env,
    String(job.task_type || 'text-to-3d'),
    String(job.external_task_id || ''),
    meshyAuth,
  );
  await env.DB.prepare(
    `UPDATE agentsam_cad_jobs SET status = 'canceled', updated_at = unixepoch() WHERE id = ?`,
  )
    .bind(jobId)
    .run();
  return { ok: true, job_id: jobId, task_id: job.external_task_id, deleted: true, meshy: deleted };
}

/**
 * In-process bridge for Meshy rigging tasks (POST /openapi/v1/rigging).
 * @param {any} env
 * @param {any} ctx
 * @param {{ userId: string; tenantId?: string; workspaceId?: string }} auth
 * @param {Record<string, unknown>} body
 */
export async function meshyRetextureInProcess(env, ctx, auth, body = {}) {
  const fakeUrl = new URL('https://inneranimalmedia.com/api/cad/meshy/retexture');
  const req = new Request(fakeUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': String(auth.userId),
      ...(auth.tenantId ? { 'X-Tenant-Id': String(auth.tenantId) } : {}),
      ...(auth.workspaceId ? { 'X-Workspace-Id': String(auth.workspaceId) } : {}),
    },
    body: JSON.stringify(body),
  });
  await primeRequestAuthForTool(req, env, auth);
  const res = await handleCadMeshyApi(req, fakeUrl, env, ctx);
  if (!res) return { error: 'meshy retexture handler missing' };
  return res.json();
}

/**
 * In-process bridge for Meshy multi-color print (POST /openapi/v1/print/multi-color).
 * @param {any} env
 * @param {any} ctx
 * @param {{ userId: string; tenantId?: string; workspaceId?: string }} auth
 * @param {Record<string, unknown>} body
 */
export async function meshyPrintMultiColorInProcess(env, ctx, auth, body = {}) {
  const fakeUrl = new URL('https://inneranimalmedia.com/api/cad/meshy/print-multi-color');
  const req = new Request(fakeUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': String(auth.userId),
      ...(auth.tenantId ? { 'X-Tenant-Id': String(auth.tenantId) } : {}),
      ...(auth.workspaceId ? { 'X-Workspace-Id': String(auth.workspaceId) } : {}),
    },
    body: JSON.stringify(body),
  });
  await primeRequestAuthForTool(req, env, auth);
  const res = await handleCadMeshyApi(req, fakeUrl, env, ctx);
  if (!res) return { error: 'meshy print-multi-color handler missing' };
  return res.json();
}

export async function meshyRiggingInProcess(env, ctx, auth, body = {}) {
  const fakeUrl = new URL('https://inneranimalmedia.com/api/cad/meshy/rigging');
  const req = new Request(fakeUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': String(auth.userId),
      ...(auth.tenantId ? { 'X-Tenant-Id': String(auth.tenantId) } : {}),
      ...(auth.workspaceId ? { 'X-Workspace-Id': String(auth.workspaceId) } : {}),
    },
    body: JSON.stringify(body),
  });
  await primeRequestAuthForTool(req, env, auth);
  const res = await handleCadMeshyApi(req, fakeUrl, env, ctx);
  if (!res) return { error: 'meshy rigging handler missing' };
  return res.json();
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {{ userId: string; tenantId?: string; workspaceId?: string }} auth
 * @param {Record<string, unknown>} body
 * @param {'remesh'|'convert'|'resize'|'uv-unwrap'} pathKey
 */
async function meshyPostProcessInProcess(env, ctx, auth, body, pathKey) {
  const fakeUrl = new URL(`https://inneranimalmedia.com/api/cad/meshy/${pathKey}`);
  const req = new Request(fakeUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': String(auth.userId),
      ...(auth.tenantId ? { 'X-Tenant-Id': String(auth.tenantId) } : {}),
      ...(auth.workspaceId ? { 'X-Workspace-Id': String(auth.workspaceId) } : {}),
    },
    body: JSON.stringify(body),
  });
  await primeRequestAuthForTool(req, env, auth);
  const res = await handleCadMeshyApi(req, fakeUrl, env, ctx);
  if (!res) return { error: `meshy ${pathKey} handler missing` };
  return res.json();
}

/** @see https://docs.meshy.ai/en/api/remesh */
export async function meshyRemeshInProcess(env, ctx, auth, body = {}) {
  return meshyPostProcessInProcess(env, ctx, auth, body, 'remesh');
}

/** @see https://docs.meshy.ai/en/api/convert */
export async function meshyConvertInProcess(env, ctx, auth, body = {}) {
  return meshyPostProcessInProcess(env, ctx, auth, body, 'convert');
}

/** @see https://docs.meshy.ai/en/api/resize */
export async function meshyResizeInProcess(env, ctx, auth, body = {}) {
  return meshyPostProcessInProcess(env, ctx, auth, body, 'resize');
}

/** @see https://docs.meshy.ai/en/api/uv-unwrap */
export async function meshyUvUnwrapInProcess(env, ctx, auth, body = {}) {
  return meshyPostProcessInProcess(env, ctx, auth, body, 'uv-unwrap');
}

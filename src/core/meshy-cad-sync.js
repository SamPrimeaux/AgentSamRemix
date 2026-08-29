/**
 * Apply Meshy task payloads to agentsam_cad_jobs (poll + webhook).
 */
import { buildCadAssetPublicUrl } from './cad-job-scope.js';
import { finalizeCadJobComplete } from './cad-job-complete.js';
import { meshyIngestAndQueuePolish } from './meshy-glb-ingest.js';
import { getMeshyTask, textTo3dRefine } from './meshy-api.js';
import { isMeshyAuthMissing, meshyKeySourceFromJob, resolveMeshyAuth } from './meshy-api-key.js';
import { MESHY_CREDIT_COSTS } from './meshy-credits.js';

const STATUS_MAP = {
  PENDING: 'pending',
  IN_PROGRESS: 'running',
  SUCCEEDED: 'done',
  FAILED: 'failed',
  CANCELED: 'failed',
};

/**
 * @param {Record<string, unknown>} payload
 */
export function meshyTaskIdFromPayload(payload) {
  const id = payload?.id ?? payload?.result ?? payload?.task_id ?? null;
  return id != null ? String(id).trim() : null;
}

/**
 * @param {Record<string, unknown>} payload
 */
export function meshyTaskStatus(payload) {
  return String(payload?.status || '').trim().toUpperCase();
}

/**
 * @param {Record<string, unknown>} payload
 */
export function meshyTaskTypeFromPayload(payload) {
  const raw = String(payload?.type || payload?.task_type || '').toLowerCase();
  if (raw.includes('image-to-3d')) return 'image-to-3d';
  if (raw.includes('retexture') || raw.includes('texture')) return 'retexture';
  if (raw.includes('remesh')) return 'remesh';
  if (raw.includes('convert')) return 'convert';
  if (raw.includes('resize')) return 'resize';
  if (raw.includes('text-to-image') || raw.includes('text_to_image')) return 'text-to-image';
  if (raw.includes('animate') || raw === 'animation') return 'animation';
  if (raw.includes('uv-unwrap') || raw.includes('uv_unwrap')) return 'uv-unwrap';
  if (raw.includes('print-multi-color') || raw.includes('multi-color')) return 'print-multi-color';
  if (raw.includes('print-repair') || raw.includes('repair-print')) return 'print-repair';
  if (raw.includes('print-analyze') || raw.includes('analyze-print')) return 'print-analyze';
  if (raw.includes('rig') || raw === 'rig') return 'rigging';
  if (raw.includes('text-to-3d') || raw.includes('text_to_3d')) return 'text-to-3d';
  if (raw.includes('refine')) return 'text-to-3d-refine';
  if (raw.includes('preview')) return 'text-to-3d-preview';
  return 'text-to-3d';
}

/**
 * @param {Record<string, unknown>} job
 */
function jobWantsAutoRefine(job) {
  if (String(job.mode) === 'image') return false;
  const td = job.texture_data;
  if (!td) return true;
  try {
    const parsed = typeof td === 'string' ? JSON.parse(td) : td;
    return parsed?.auto_refine !== false;
  } catch {
    return true;
  }
}

/**
 * @param {any} env
 * @param {string} externalTaskId
 */
export async function findCadJobByExternalTaskId(env, externalTaskId) {
  if (!env?.DB || !externalTaskId) return null;
  return env.DB.prepare(
    `SELECT * FROM agentsam_cad_jobs
     WHERE engine = 'meshy' AND external_task_id = ?
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(externalTaskId)
    .first();
}

/**
 * @param {any} env
 * @param {string} parentTaskId
 */
export async function findCadJobByParentTaskId(env, parentTaskId) {
  if (!env?.DB || !parentTaskId) return null;
  return env.DB.prepare(
    `SELECT * FROM agentsam_cad_jobs
     WHERE engine = 'meshy' AND parent_task_id = ?
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(parentTaskId)
    .first();
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {Record<string, unknown>} job
 * @param {Record<string, unknown>} scope
 * @param {string | null | undefined} glbUrl
 */
async function meshyIngestIfDone(env, ctx, job, scope, glbUrl) {
  return meshyIngestAndQueuePolish(env, ctx, job, scope, glbUrl);
}

async function meshyAuthForJob(env, job) {
  return resolveMeshyAuth(
    env,
    { userId: job.user_id, tenant_id: job.tenant_id },
    { keySource: meshyKeySourceFromJob(job) },
  );
}

/**
 * Chain preview → refine when preview succeeds and auto_refine is enabled.
 * @param {any} env
 * @param {any} ctx
 * @param {Record<string, unknown>} job
 * @param {string} previewTaskId
 */
async function chainMeshyRefineAfterPreview(env, ctx, job, previewTaskId) {
  const meshyAuth = await meshyAuthForJob(env, job);
  if (isMeshyAuthMissing(meshyAuth)) return { ok: false, reason: 'stub_key' };
  if (!jobWantsAutoRefine(job)) return { ok: false, reason: 'auto_refine_disabled' };

  const existingRefine = await findCadJobByParentTaskId(env, previewTaskId);
  if (existingRefine && existingRefine.external_task_id) {
    return { ok: true, skipped: 'refine_already_started', refine_task_id: existingRefine.external_task_id };
  }

  try {
    const { task_id: refineTaskId } = await textTo3dRefine(env, {
      preview_task_id: previewTaskId,
      enable_pbr: true,
    }, meshyAuth);
    if (!refineTaskId) return { ok: false, reason: 'no_refine_task_id' };

    await env.DB.prepare(
      `UPDATE agentsam_cad_jobs SET
         external_task_id = ?,
         parent_task_id = ?,
         status = 'running',
         progress_pct = COALESCE(progress_pct, 50),
         credits_consumed = COALESCE(credits_consumed, 0) + ?,
         updated_at = unixepoch()
       WHERE id = ?`,
    )
      .bind(refineTaskId, previewTaskId, MESHY_CREDIT_COSTS.TEXT_TO_3D_REFINE, String(job.id))
      .run();

    ctx?.waitUntil?.(
      getMeshyTask(env, 'text-to-3d', refineTaskId, meshyAuth)
        .then((task) => applyMeshyTaskToCadJob(env, ctx, task))
        .catch(() => null),
    );

    return { ok: true, refine_task_id: refineTaskId, phase: 'refine' };
  } catch (e) {
    console.warn('[meshy-cad-sync] refine chain failed:', e?.message ?? e);
    return { ok: false, reason: 'refine_failed', error: e?.message ?? String(e) };
  }
}

/**
 * @param {Record<string, unknown>} taskPayload
 */
function isPreviewStageComplete(taskPayload) {
  const type = meshyTaskTypeFromPayload(taskPayload);
  return type.includes('preview') || String(taskPayload?.mode || '').toLowerCase() === 'preview';
}

/**
 * @param {Record<string, unknown>} taskPayload
 */
function isFinalMeshyStage(taskPayload, job) {
  const type = meshyTaskTypeFromPayload(taskPayload);
  if (
    type === 'rigging' ||
    type === 'retexture' ||
    type === 'remesh' ||
    type === 'convert' ||
    type === 'resize' ||
    type === 'text-to-image' ||
    type === 'animation' ||
    type === 'uv-unwrap' ||
    type === 'print-multi-color' ||
    type === 'print-repair' ||
    String(job?.task_type) === 'rigging' ||
    String(job?.task_type) === 'retexture' ||
    String(job?.task_type) === 'remesh' ||
    String(job?.task_type) === 'convert' ||
    String(job?.task_type) === 'resize' ||
    String(job?.task_type) === 'text-to-image' ||
    String(job?.task_type) === 'animation' ||
    String(job?.task_type) === 'uv-unwrap' ||
    String(job?.task_type) === 'print-multi-color' ||
    String(job?.task_type) === 'print-repair'
  ) {
    return true;
  }
  if (String(job?.mode) === 'image') return true;
  if (type.includes('refine')) return true;
  if (job?.parent_task_id) return true;
  if (!jobWantsAutoRefine(job)) return isPreviewStageComplete(taskPayload);
  return type.includes('refine');
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {Record<string, unknown>} taskPayload
 */
export async function applyMeshyTaskToCadJob(env, ctx, taskPayload) {
  if (!env?.DB) return { ok: false, reason: 'db_missing' };

  const externalTaskId = meshyTaskIdFromPayload(taskPayload);
  if (!externalTaskId) return { ok: false, reason: 'missing_task_id' };

  const job = await findCadJobByExternalTaskId(env, externalTaskId);
  if (!job) {
    return { ok: true, ignored: true, reason: 'job_not_found', external_task_id: externalTaskId };
  }

  const jobId = String(job.id);
  if (['done', 'failed', 'stub'].includes(String(job.status))) {
    return { ok: true, job_id: jobId, status: String(job.status), skipped: 'terminal' };
  }

  const meshyStatus = meshyTaskStatus(taskPayload);
  const mappedStatus = STATUS_MAP[meshyStatus] || String(job.status);
  const progress = Number(taskPayload?.progress) || null;
  const taskType = meshyTaskTypeFromPayload(taskPayload);

  if (mappedStatus === 'running' || mappedStatus === 'pending') {
    await env.DB.prepare(
      `UPDATE agentsam_cad_jobs SET status = ?, progress_pct = COALESCE(?, progress_pct),
         task_type = COALESCE(task_type, ?), updated_at = unixepoch() WHERE id = ?`,
    )
      .bind(mappedStatus, progress, String(job.task_type || 'text-to-3d'), jobId)
      .run();
    return { ok: true, job_id: jobId, status: mappedStatus, progress, phase: taskType };
  }

  if (mappedStatus === 'failed') {
    const errMsg =
      String(taskPayload?.message || taskPayload?.error || taskPayload?.task_error?.message || 'Meshy generation failed').slice(
        0,
        500,
      );
    await env.DB.prepare(
      `UPDATE agentsam_cad_jobs SET status='failed', error=?, updated_at=unixepoch() WHERE id=?`,
    )
      .bind(errMsg, jobId)
      .run();
    ctx?.waitUntil?.(
      finalizeCadJobComplete(env, ctx, { job_id: jobId, status: 'failed', error: errMsg }).catch(() => null),
    );
    return { ok: true, job_id: jobId, status: 'failed', error: errMsg };
  }

  if (mappedStatus !== 'done') {
    return { ok: true, job_id: jobId, status: mappedStatus, skipped: 'non_terminal' };
  }

  // Preview succeeded — chain refine unless disabled or already refining
  if (isPreviewStageComplete(taskPayload) && jobWantsAutoRefine(job) && !job.parent_task_id) {
    const chained = await chainMeshyRefineAfterPreview(env, ctx, job, externalTaskId);
    if (chained.ok && chained.refine_task_id) {
      return {
        ok: true,
        job_id: jobId,
        status: 'running',
        phase: 'refine',
        refine_task_id: chained.refine_task_id,
        progress: progress ?? 50,
      };
    }
  }

  if (!isFinalMeshyStage(taskPayload, job)) {
    return { ok: true, job_id: jobId, status: 'running', phase: taskType, progress };
  }

  const glbUrl =
    (taskType === 'animation' && taskPayload?.result?.animation_glb_url
      ? taskPayload.result.animation_glb_url
      : null) ||
    (taskType === 'rigging' && taskPayload?.result?.rigged_character_glb_url
      ? taskPayload.result.rigged_character_glb_url
      : null) ||
    taskPayload?.model_urls?.glb ||
    taskPayload?.model_urls?.stl ||
    taskPayload?.model_urls?.['3mf'] ||
    taskPayload?.model_url ||
    taskPayload?.result?.rigged_character_glb_url ||
    taskPayload?.result?.animation_glb_url ||
    taskPayload?.result?.basic_animations?.walking_glb_url ||
    taskPayload?.result?.basic_animations?.running_glb_url ||
    (Array.isArray(taskPayload?.image_urls) && taskPayload.image_urls[0]) ||
    null;
  let modelFormats = null;
  if (taskType === 'animation' && taskPayload?.result && typeof taskPayload.result === 'object') {
    const ar = taskPayload.result;
    modelFormats = {
      animation_glb_url: ar.animation_glb_url ?? null,
      animation_fbx_url: ar.animation_fbx_url ?? null,
      processed_usdz_url: ar.processed_usdz_url ?? null,
      processed_armature_fbx_url: ar.processed_armature_fbx_url ?? null,
      processed_animation_fps_fbx_url: ar.processed_animation_fps_fbx_url ?? null,
    };
  } else if (
    (taskType === 'rigging' || String(job?.task_type) === 'rigging') &&
    taskPayload?.result &&
    typeof taskPayload.result === 'object'
  ) {
    const rr = taskPayload.result;
    const basic = rr.basic_animations && typeof rr.basic_animations === 'object' ? rr.basic_animations : {};
    modelFormats = {
      rigged_character_glb_url: rr.rigged_character_glb_url ?? null,
      rigged_character_fbx_url: rr.rigged_character_fbx_url ?? null,
      walking_glb_url: basic.walking_glb_url ?? null,
      walking_fbx_url: basic.walking_fbx_url ?? null,
      walking_armature_glb_url: basic.walking_armature_glb_url ?? null,
      running_glb_url: basic.running_glb_url ?? null,
      running_fbx_url: basic.running_fbx_url ?? null,
      running_armature_glb_url: basic.running_armature_glb_url ?? null,
    };
  } else if (
    (taskType === 'retexture' || String(job?.task_type) === 'retexture') &&
    taskPayload?.model_urls &&
    typeof taskPayload.model_urls === 'object'
  ) {
    modelFormats = {
      ...taskPayload.model_urls,
      thumbnail_url: taskPayload.thumbnail_url ?? null,
      alpha_thumbnail_url: taskPayload.alpha_thumbnail_url ?? null,
      text_style_prompt: taskPayload.text_style_prompt ?? null,
      image_style_url: taskPayload.image_style_url ?? null,
    };
  } else if (
    (taskType === 'image-to-3d' || String(job?.task_type) === 'image-to-3d') &&
    taskPayload?.model_urls &&
    typeof taskPayload.model_urls === 'object'
  ) {
    modelFormats = {
      ...taskPayload.model_urls,
      thumbnail_url: taskPayload.thumbnail_url ?? null,
      alpha_thumbnail_url: taskPayload.alpha_thumbnail_url ?? null,
      thumbnail_urls: taskPayload.thumbnail_urls ?? null,
    };
  } else if (taskPayload?.model_urls && typeof taskPayload.model_urls === 'object') {
    modelFormats = {
      ...taskPayload.model_urls,
      thumbnail_url: taskPayload.thumbnail_url ?? null,
      alpha_thumbnail_url: taskPayload.alpha_thumbnail_url ?? null,
    };
  }
  const textureData = taskPayload?.texture_urls ?? null;
  const scope = {
    workspaceId: job.workspace_id,
    tenantId: job.tenant_id,
    projectId: job.project_id,
    sceneSnapshotId: job.scene_snapshot_id,
  };
  const ingested = await meshyIngestIfDone(env, ctx, job, scope, glbUrl ? String(glbUrl) : null);
  const publicUrl = ingested?.public_url || buildCadAssetPublicUrl(ingested?.r2_key) || glbUrl;

  const creditsConsumed = Number(taskPayload?.credits_consumed ?? taskPayload?.credits ?? 0) || null;

  if (!ingested && glbUrl) {
    await env.DB.prepare(
      `UPDATE agentsam_cad_jobs SET status='done', result_url=?, progress_pct=100,
         model_formats = COALESCE(?, model_formats),
         texture_data = COALESCE(?, texture_data),
         credits_consumed = COALESCE(?, credits_consumed),
         updated_at=unixepoch() WHERE id=?`,
    )
      .bind(
        String(glbUrl),
        modelFormats ? JSON.stringify(modelFormats) : null,
        textureData ? JSON.stringify(textureData) : null,
        creditsConsumed,
        jobId,
      )
      .run();
  } else if (ingested) {
    await env.DB.prepare(
      `UPDATE agentsam_cad_jobs SET
         model_formats = COALESCE(?, model_formats),
         texture_data = CASE WHEN ? = 1 THEN texture_data ELSE COALESCE(?, texture_data) END,
         credits_consumed = COALESCE(?, credits_consumed),
         updated_at = unixepoch()
       WHERE id = ?`,
    )
      .bind(
        modelFormats ? JSON.stringify(modelFormats) : null,
        ingested.pending_polish ? 1 : 0,
        textureData ? JSON.stringify(textureData) : null,
        creditsConsumed,
        jobId,
      )
      .run();
  }

  return {
    ok: true,
    job_id: jobId,
    status: ingested?.pending_polish ? 'running' : 'done',
    public_url: ingested?.pending_polish ? null : publicUrl,
    r2_key: ingested?.r2_key ?? null,
    cms_asset: ingested?.cms_asset ?? null,
    progress_pct: ingested?.pending_polish ? 92 : 100,
    phase: taskType,
    pending_polish: !!ingested?.pending_polish,
  };
}

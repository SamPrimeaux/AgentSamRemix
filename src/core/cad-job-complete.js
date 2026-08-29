/**
 * Finalize agentsam_cad_jobs — R2 ingest, cms_assets, scene link, usage, todos.
 */
import { normalizeGlbPublicUrl } from './glb-public-url.js';
import { writeUsageEvent } from '../../backend/telemetry/usage-events.js';
import { emitAgentSessionDesignStudioEvent } from '../api/designstudio/sync.js';
import {
  buildCadAssetPublicUrl,
  buildCadExportR2Key,
  cadJobR2Bucket,
  resolveCadR2Binding,
} from './cad-job-scope.js';

const CMS_ASSETS = 'cms_assets';

/** @param {unknown} raw */
export function parseCadJobTextureData(raw) {
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : (raw && typeof raw === 'object' ? raw : {});
  } catch {
    return {};
  }
}

/** @param {Record<string, unknown> | null | undefined} job @param {Record<string, unknown>} [body] */
export function cadJobShouldRegisterCmsAsset(job, body = {}) {
  if (body.register_cms_asset === false) return false;
  const td = parseCadJobTextureData(job?.texture_data);
  return td.register_cms_asset !== false;
}

/** @param {Record<string, unknown> | null | undefined} job */
export function cadJobSkipGlbPolish(job) {
  const td = parseCadJobTextureData(job?.texture_data);
  return td.skip_glb_polish === true;
}

/**
 * Download remote GLB and store on R2 ASSETS binding.
 * @param {any} env
 * @param {{ tenantId: string, workspaceId: string, jobId: string, sourceUrl: string }} p
 */
export async function ingestRemoteGlbToR2(env, p) {
  const binding = resolveCadR2Binding(env);
  if (!binding?.put) throw new Error('CAD/ASSETS binding unavailable');
  const url = String(p.sourceUrl || '').trim();
  if (!url) throw new Error('missing_glb_url');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`glb_download_failed:${res.status}`);
  const buf = await res.arrayBuffer();
  if (!buf || buf.byteLength < 32) throw new Error('glb_empty');

  const r2Key = buildCadExportR2Key(p.tenantId, p.workspaceId, p.jobId, 'glb');
  await binding.put(r2Key, buf, {
    httpMetadata: { contentType: 'model/gltf-binary' },
  });
  return {
    r2_bucket: cadJobR2Bucket(env),
    r2_key: r2Key,
    public_url: buildCadAssetPublicUrl(r2Key, env?.CAD_R2_PUBLIC_ORIGIN),
    size_bytes: buf.byteLength,
  };
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} job
 * @param {{ r2_key: string, public_url: string, size_bytes?: number }} asset
 * @param {Record<string, unknown>} [body]
 */
export async function registerCadGlbCmsAsset(env, job, asset, body = {}) {
  if (!env?.DB) return null;
  const userId = String(job.user_id || '').trim();
  const tenantId = String(job.tenant_id || '').trim();
  if (!userId || !tenantId) return null;

  const assetId = `ds_cad_${String(job.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 20)}`;
  const publicUrl = normalizeGlbPublicUrl(asset.public_url);
  const r2Key = String(asset.r2_key || '').trim();
  const label =
    String(job.prompt || '').trim().slice(0, 80) ||
    `${String(job.engine || 'cad')} export`;

  const pathValue = publicUrl.startsWith('/assets/') ? publicUrl : r2Key;
  const placementSidecar =
    body.placement_sidecar && typeof body.placement_sidecar === 'object'
      ? body.placement_sidecar
      : null;
  const placementSidecarUrl =
    body.placement_sidecar_url != null ? String(body.placement_sidecar_url).trim() : '';
  const metadata = JSON.stringify({
    label,
    cad_job_id: job.id,
    engine: job.engine,
    project_id: job.project_id ?? null,
    ...(placementSidecarUrl ? { placement_sidecar_url: placementSidecarUrl } : {}),
    ...(placementSidecar ? { placement_sidecar: placementSidecar } : {}),
    ...(placementSidecar?.spawn?.profile === 'bim' || body.spawn_profile === 'bim'
      ? { spawn_profile: 'bim', fit_to_viewport: false, source_units: placementSidecar?.units ?? 'mm' }
      : {}),
  });

  await env.DB.prepare(
    `INSERT INTO ${CMS_ASSETS} (
       id, tenant_id, filename, original_filename, path, size, mime_type, category,
       tags, r2_key, public_url, metadata, created_by, is_live, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       public_url = excluded.public_url,
       r2_key = excluded.r2_key,
       metadata = excluded.metadata,
       updated_at = datetime('now')`,
  )
    .bind(
      assetId,
      tenantId,
      `${assetId}.glb`,
      `${assetId}.glb`,
      pathValue,
      Number(asset.size_bytes) || 0,
      'model/gltf-binary',
      '3d_studio_user',
      'designstudio,cad',
      r2Key,
      publicUrl,
      metadata,
      userId,
    )
    .run()
    .catch(async () => {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO ${CMS_ASSETS} (
           id, tenant_id, filename, original_filename, path, size, mime_type, category,
           tags, r2_key, public_url, metadata, created_by, is_live, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`,
      )
        .bind(
          assetId,
          tenantId,
          `${assetId}.glb`,
          `${assetId}.glb`,
          pathValue,
          Number(asset.size_bytes) || 0,
          'model/gltf-binary',
          '3d_studio_user',
          'designstudio,cad',
          r2Key,
          publicUrl,
          metadata,
          userId,
        )
        .run();
    });

  return { asset_id: assetId, public_url: publicUrl, r2_key: r2Key };
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} job
 * @param {{ r2_key?: string|null, public_url?: string|null }} asset
 */
export async function linkCadJobToScene(env, job, asset) {
  const sceneId = String(job.scene_snapshot_id || '').trim();
  if (!env?.DB || !sceneId) return null;

  const glbKey = String(asset.r2_key || '').trim() || null;
  const publicUrl = asset.public_url ? String(asset.public_url) : null;

  await env.DB.prepare(
    `UPDATE scene_snapshots SET
       cad_job_id = ?,
       glb_r2_key = COALESCE(?, glb_r2_key),
       public_url = COALESCE(?, public_url),
       project_id = COALESCE(?, project_id),
       updated_at = unixepoch()
     WHERE id = ?`,
  )
    .bind(job.id, glbKey, publicUrl, job.project_id ?? null, sceneId)
    .run()
    .catch(() => null);

  return sceneId;
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {Record<string, unknown>} job
 * @param {{ duration_ms?: number, cost_usd?: number, status?: string, reason?: string }} meta
 */
export async function recordCadJobUsageEvent(env, ctx, job, meta = {}) {
  const workspaceId = String(job.workspace_id || '').trim();
  const tenantId = String(job.tenant_id || '').trim();
  if (!workspaceId || !tenantId) return null;

  const engine = String(job.engine || 'cad').toLowerCase();
  const provider =
    engine === 'meshy' ? 'meshy' : engine === 'openscad' ? 'openscad' : engine === 'blender' ? 'blender' : 'cad';

  return writeUsageEvent(
    env,
    {
      model: engine,
      model_key: `cad_${engine}`,
      provider,
      workspace_id: workspaceId,
      tenant_id: tenantId,
      user_id: job.user_id != null ? String(job.user_id) : null,
      session_id: job.session_id != null ? String(job.session_id) : null,
      event_type: 'tool_call',
      tool_name: `cad_${engine}`,
      duration_ms: Number(meta.duration_ms) || null,
      cost_usd: Number(meta.cost_usd) || 0,
      ref_table: 'agentsam_cad_jobs',
      ref_id: String(job.id || ''),
      status: meta.status === 'failed' ? 'error' : 'ok',
      reason: meta.reason != null ? String(meta.reason) : null,
      task_type: 'designstudio_cad',
      mode: 'agent',
    },
    ctx,
  );
}

/** @param {any} env @param {Record<string, unknown>} job @param {string} error */
export async function recordCadJobFailureTodo(env, job, error) {
  if (!env?.DB) return null;
  const tenantId = String(job.tenant_id || '').trim();
  if (!tenantId) return null;

  const todoId = `todo_cad_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const title = `CAD job failed (${String(job.engine || 'cad')}): ${String(job.id || '').slice(0, 24)}`;
  const err = String(error || job.error || 'unknown').slice(0, 500);

  await env.DB.prepare(
    `INSERT INTO agentsam_todo (
       id, tenant_id, workspace_id, title, description, task_type, execution_status,
       linked_table, linked_route, category, created_by, project_key, sort_order,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'execute', 'queued', ?, ?, 'designstudio', 'cad_runner', 'designstudio', 0, datetime('now'), datetime('now'))`,
  )
    .bind(
      todoId,
      tenantId,
      job.workspace_id != null ? String(job.workspace_id) : null,
      title,
      err,
      'agentsam_cad_jobs',
      String(job.id || ''),
    )
    .run()
    .catch(() => null);

  return todoId;
}

/** Resolve agent run that created a CAD job (tool log output contains job_id). */
async function lookupAgentRunIdForCadJob(env, jobId) {
  const id = String(jobId || '').trim();
  if (!id || !env?.DB) return null;
  try {
    const needle = `%"job_id":"${id}"%`;
    const row = await env.DB.prepare(
      `SELECT agent_run_id FROM agentsam_tool_call_log
       WHERE agent_run_id IS NOT NULL AND trim(agent_run_id) != ''
         AND (output_json LIKE ? OR output_summary LIKE ?)
       ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(needle, `%${id}%`)
      .first();
    const runId = row?.agent_run_id != null ? String(row.agent_run_id).trim() : '';
    return runId || null;
  } catch {
    return null;
  }
}

/**
 * Complete a CAD job from runner or Meshy poll.
 * @param {any} env
 * @param {any} ctx
 * @param {Record<string, unknown>} body
 */
export async function finalizeCadJobComplete(env, ctx, body) {
  if (!env?.DB) throw new Error('Database not configured');

  const jobId = String(body.job_id || '').trim();
  if (!jobId) throw new Error('job_id required');

  const job = await env.DB.prepare(`SELECT * FROM agentsam_cad_jobs WHERE id = ? LIMIT 1`)
    .bind(jobId)
    .first();
  if (!job) throw new Error('job not found');

  const status = String(body.status || 'done').toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const durationMs = Number(body.duration_ms) || null;
  const progressPct = status === 'done' ? 100 : Number(body.progress_pct) || Number(job.progress_pct) || 0;

  if (status === 'failed') {
    const err = String(body.error || 'cad_job_failed').slice(0, 2000);
    await env.DB.prepare(
      `UPDATE agentsam_cad_jobs SET
         status = 'failed', error = ?, error_code = ?, progress_pct = ?,
         finished_at = ?, updated_at = unixepoch()
       WHERE id = ?`,
    )
      .bind(err, String(body.error_code || 'runner_failed').slice(0, 64), progressPct, now, jobId)
      .run();
    await recordCadJobUsageEvent(env, ctx, { ...job, status: 'failed', error: err }, {
      duration_ms: durationMs,
      status: 'failed',
      reason: err,
    });
    await recordCadJobFailureTodo(env, { ...job, error: err }, err);
    return { ok: true, job_id: jobId, status: 'failed', error: err };
  }

  const r2Key = String(body.r2_key || job.r2_key || '').trim();
  const r2Bucket = String(body.r2_bucket || job.r2_bucket || cadJobR2Bucket(env)).trim();
  const publicUrl =
    String(body.public_url || '').trim() ||
    (r2Key && !r2Key.startsWith('b64:') && !r2Key.includes('\n')
      ? buildCadAssetPublicUrl(r2Key, env?.CAD_R2_PUBLIC_ORIGIN)
      : String(job.result_url || '').trim());

  let cmsAsset = null;
  if (r2Key && publicUrl) {
    if (cadJobShouldRegisterCmsAsset(job, body)) {
      cmsAsset = await registerCadGlbCmsAsset(env, job, {
        r2_key: r2Key,
        public_url: publicUrl,
        size_bytes: body.size_bytes,
      }, body);
    }
    await linkCadJobToScene(env, job, { r2_key: r2Key, public_url: publicUrl });
  }

  await env.DB.prepare(
    `UPDATE agentsam_cad_jobs SET
       status = 'done',
       r2_key = COALESCE(?, r2_key),
       r2_bucket = COALESCE(?, r2_bucket),
       result_url = COALESCE(?, result_url),
       progress_pct = 100,
       finished_at = ?,
       runner_host = COALESCE(?, runner_host),
       updated_at = unixepoch()
     WHERE id = ?`,
  )
    .bind(
      r2Key || null,
      r2Bucket || null,
      publicUrl || null,
      now,
      body.runner_host != null ? String(body.runner_host) : null,
      jobId,
    )
    .run();

  await recordCadJobUsageEvent(env, ctx, job, {
    duration_ms: durationMs,
    cost_usd: Number(body.cost_usd) || 0,
    status: 'ok',
  });

  if (publicUrl) {
    const agentRunId =
      body.agent_run_id != null && String(body.agent_run_id).trim()
        ? String(body.agent_run_id).trim()
        : await lookupAgentRunIdForCadJob(env, jobId);
    await emitAgentSessionDesignStudioEvent(env, job.session_id, {
      type: 'cad_glb_ready',
      job_id: jobId,
      agent_run_id: agentRunId,
      session_id: job.session_id ?? null,
      url: publicUrl,
      public_url: publicUrl,
      r2_key: r2Key || null,
      blueprint_id: job.project_id ?? null,
      scene_snapshot_id: job.scene_snapshot_id ?? null,
      engine: job.engine ?? null,
    }).catch((e) => {
      console.warn('[cad-job-complete] cad_glb_ready stream failed:', e?.message ?? e);
    });
  }

  return {
    ok: true,
    job_id: jobId,
    status: 'done',
    r2_key: r2Key || null,
    public_url: publicUrl || null,
    cms_asset: cmsAsset,
  };
}

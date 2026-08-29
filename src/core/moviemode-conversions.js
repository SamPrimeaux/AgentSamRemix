/**
 * MovieMode format conversion lane — ffmpeg / CloudConvert job tracking (D1 only).
 * Heavy transcode runs on PTY or external service; Worker registers + updates status.
 */

import { ensureMoviemodeExportProject } from './moviemode-projects.js';

function newJobId() {
  return `mmconv_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function newConversionId() {
  return `mmcv_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/**
 * @param {unknown} env
 * @param {{ workspaceId: string, tenantId: string, userId?: string }} auth
 * @param {{ asset_id: string, output_format: string, input_format?: string, service?: string, project_id?: string }} body
 */
export async function enqueueMoviemodeConversion(env, auth, body) {
  const workspaceId = String(auth.workspaceId || '').trim();
  const tenantId = String(auth.tenantId || '').trim();
  let sourceAssetId = String(body.asset_id || '').trim();
  const preset = String(body.preset || body.workflow || '').trim();
  const isCapturePreset = preset.startsWith('capture-website');
  const captureUrl = body.capture_url ? String(body.capture_url).trim() : '';
  let outputFormat = String(body.output_format || 'mp4').trim().toLowerCase();
  const inputFormat = String(body.input_format || 'auto').trim().toLowerCase();
  const service = String(body.service || 'ffmpeg').trim().toLowerCase();

  if (!['ffmpeg', 'cloudconvert', 'pty'].includes(service)) {
    throw new Error('service must be ffmpeg, cloudconvert, or pty');
  }

  if (isCapturePreset && captureUrl) {
    outputFormat = preset.endsWith('png') ? 'png' : 'pdf';
    if (!sourceAssetId) {
      sourceAssetId = `asset_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await env.DB.prepare(
        `INSERT INTO media_assets (
           id, tenant_id, workspace_id, source_kind, source_uri, bucket, object_key,
           filename, content_type, media_kind, status, metadata_json
         ) VALUES (?, ?, ?, 'capture_request', ?, 'inneranimalmedia', '', ?, ?, 'document', 'uploaded', ?)`,
      )
        .bind(
          sourceAssetId,
          tenantId,
          workspaceId,
          captureUrl,
          `capture-${Date.now()}.${outputFormat}`,
          outputFormat === 'png' ? 'image/png' : 'application/pdf',
          JSON.stringify({ capture_url: captureUrl, lane: 'cloudconvert_capture' }),
        )
        .run();
    }
  } else if (!sourceAssetId) {
    throw new Error('asset_id required');
  }

  const asset = await env.DB.prepare(
    `SELECT * FROM media_assets WHERE id = ? AND workspace_id = ? LIMIT 1`,
  )
    .bind(sourceAssetId, workspaceId)
    .first();
  if (!asset) throw new Error('source asset not found');

  let projectId = body.project_id ? String(body.project_id).trim() : null;
  if (projectId) {
    const { ensureMoviemodeProject } = await import('./moviemode-projects.js');
    await ensureMoviemodeProject(env, { tenantId, workspaceId, projectId });
  } else {
    projectId = await ensureMoviemodeExportProject(env, { tenantId, workspaceId });
  }

  const id = newJobId();
  const metadata = {
    enqueued_by: auth.userId || null,
    source_filename: asset.filename || null,
    source_object_key: asset.object_key || null,
    lane: 'moviemode_conversion',
  };

  await env.DB.prepare(
    `INSERT INTO moviemode_conversion_jobs (
       id, tenant_id, workspace_id, project_id, source_asset_id,
       service, input_format, output_format, status, progress_pct, metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?)`,
  )
    .bind(
      id,
      tenantId,
      workspaceId,
      projectId,
      sourceAssetId,
      service,
      inputFormat,
      outputFormat,
      JSON.stringify(metadata),
    )
    .run();

  if (service === 'cloudconvert') {
    try {
      const {
        createCloudConvertPresetJob,
        createCloudConvertSyncJob,
        createCloudConvertJob,
        buildAssetImportUrlForCloudConvert,
      } = await import('./cloudconvert-api.js');

      const ccPreset = preset || 'video-h264';
      metadata.preset = ccPreset;
      metadata.convert_options = body.convert_options || body.options || {};
      if (body.capture_url) metadata.capture_url = String(body.capture_url);
      if (body.ffmpeg_arguments) metadata.ffmpeg_arguments = String(body.ffmpeg_arguments);

      const importUrl = isCapturePreset
        ? undefined
        : await buildAssetImportUrlForCloudConvert(env, asset);
      const workflowCtx = {
        env,
        asset: isCapturePreset ? undefined : asset,
        importUrl,
        workspaceId,
        jobId: id,
        projectId,
        convertOptions: metadata.convert_options,
        captureUrl: body.capture_url ? String(body.capture_url) : undefined,
        ffmpegArguments: body.ffmpeg_arguments ? String(body.ffmpeg_arguments) : undefined,
      };

      let ccJob;
      let exportMode = 'url';
      const usePreset = Boolean(body.preset || body.workflow);

      if (body.sync === true && usePreset) {
        ccJob = await createCloudConvertSyncJob(env, ccPreset, workflowCtx);
      } else if (usePreset) {
        const out = await createCloudConvertPresetJob(env, ccPreset, workflowCtx);
        ccJob = out.job;
        exportMode = out.export_mode;
        metadata.outputs = out.outputs;
        metadata.r2_outputs = out.r2_outputs;
      } else {
        ccJob = await createCloudConvertJob(env, importUrl, {
          output_format: outputFormat,
          input_format: inputFormat,
          tag: id,
          convert_options: metadata.convert_options?.convert || metadata.convert_options,
        });
      }

      metadata.cloudconvert_job_id = ccJob.id;
      metadata.export_mode = exportMode;
      await env.DB.prepare(
        `UPDATE moviemode_conversion_jobs SET
           status = 'running',
           external_job_id = ?,
           progress_pct = 10,
           metadata_json = ?,
           updated_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(String(ccJob.id), JSON.stringify(metadata), id)
        .run();
      return {
        id,
        status: body.sync === true ? 'complete' : 'running',
        service,
        preset: ccPreset,
        output_format: outputFormat,
        project_id: projectId,
        external_job_id: ccJob.id,
        export_mode: exportMode,
        cloudconvert: body.sync === true ? ccJob : undefined,
      };
    } catch (e) {
      metadata.cloudconvert_error = String(e?.message || e).slice(0, 400);
      await env.DB.prepare(
        `UPDATE moviemode_conversion_jobs SET
           status = 'failed',
           error_message = ?,
           metadata_json = ?,
           updated_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(String(e?.message || e).slice(0, 400), JSON.stringify(metadata), id)
        .run();
      throw e;
    }
  }

  if (env._ctx?.waitUntil) {
    env._ctx.waitUntil(markConversionJobRunning(env, id).catch(() => {}));
  }

  return { id, status: 'queued', service, output_format: outputFormat, project_id: projectId };
}

async function markConversionJobRunning(env, jobId) {
  await env.DB.prepare(
    `UPDATE moviemode_conversion_jobs SET status = 'running', progress_pct = 5, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(jobId)
    .run();

  const row = await env.DB.prepare(
    `SELECT metadata_json FROM moviemode_conversion_jobs WHERE id = ? LIMIT 1`,
  )
    .bind(jobId)
    .first();
  let meta = {};
  try {
    meta = JSON.parse(row?.metadata_json || '{}');
  } catch {
    meta = {};
  }
  meta.pty_pickup = 'awaiting_ffmpeg_worker';

  await env.DB.prepare(
    `UPDATE moviemode_conversion_jobs SET
       status = 'pending',
       progress_pct = 0,
       error_message = NULL,
       metadata_json = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(JSON.stringify(meta), jobId)
    .run();
}

/**
 * Complete a conversion job (PTY bridge or webhook).
 * @param {unknown} env
 * @param {string} jobId
 * @param {{ status: string, output_asset_id?: string, result_bucket?: string, result_object_key?: string, output_url?: string, error_message?: string, external_job_id?: string }} patch
 */
export async function finalizeMoviemodeConversionJob(env, jobId, patch) {
  const row = await env.DB.prepare(`SELECT * FROM moviemode_conversion_jobs WHERE id = ? LIMIT 1`)
    .bind(jobId)
    .first();
  if (!row) throw new Error('conversion job not found');

  const status = String(patch.status || 'complete').trim().toLowerCase();
  await env.DB.prepare(
    `UPDATE moviemode_conversion_jobs SET
       status = ?,
       output_asset_id = COALESCE(?, output_asset_id),
       result_bucket = COALESCE(?, result_bucket),
       result_object_key = COALESCE(?, result_object_key),
       external_job_id = COALESCE(?, external_job_id),
       error_message = ?,
       progress_pct = CASE WHEN ? = 'complete' THEN 100 ELSE progress_pct END,
       completed_at = CASE WHEN ? IN ('complete', 'failed', 'cancelled') THEN datetime('now') ELSE completed_at END,
       updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(
      status,
      patch.output_asset_id || null,
      patch.result_bucket || null,
      patch.result_object_key || null,
      patch.external_job_id || null,
      patch.error_message || null,
      status,
      status,
      jobId,
    )
    .run();

  if (status === 'complete') {
    const convId = newConversionId();
    await env.DB.prepare(
      `INSERT INTO moviemode_conversions (
         id, conversion_job_id, tenant_id, workspace_id, source_asset_id, output_asset_id,
         source_format, target_format, service, status, external_job_id, output_url, completed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'complete', ?, ?, datetime('now'))`,
    )
      .bind(
        convId,
        jobId,
        row.tenant_id,
        row.workspace_id,
        row.source_asset_id,
        patch.output_asset_id || row.output_asset_id || null,
        row.input_format,
        row.output_format,
        row.service,
        patch.external_job_id || row.external_job_id || null,
        patch.output_url || null,
      )
      .run();
  }

  return { ok: true, id: jobId, status };
}

/**
 * Apply CloudConvert job.* webhooks → moviemode_conversion_jobs lane.
 */

import { finalizeMoviemodeConversionJob } from './moviemode-conversions.js';

/**
 * @param {unknown} job
 */
export function extractCloudConvertExportUrl(job) {
  const artifacts = extractCloudConvertArtifacts(job);
  return artifacts.video?.url || artifacts.capture?.url || artifacts.thumbnail?.url || null;
}

/**
 * @param {unknown} job
 * @returns {{
 *   video: { url?: string, filename?: string } | null,
 *   thumbnail: { url?: string, filename?: string } | null,
 *   capture: { url?: string, filename?: string } | null,
 * }}
 */
export function extractCloudConvertArtifacts(job) {
  const out = { video: null, thumbnail: null, capture: null };
  const tasks = Array.isArray(job?.tasks) ? job.tasks : [];

  for (const task of tasks) {
    if (String(task?.status || '') !== 'finished') continue;
    const op = String(task?.operation || '');
    if (op !== 'export/url' && op !== 'export/s3') continue;

    const name = String(task?.name || '');
    const files = Array.isArray(task?.result?.files) ? task.result.files : [];
    const file = files[0] || {};
    const entry = {
      url: file.url ? String(file.url) : undefined,
      filename: file.filename ? String(file.filename) : undefined,
      size: file.size != null ? Number(file.size) : undefined,
      operation: op,
    };

    if (name === 'export-thumb' || name.includes('thumb')) {
      out.thumbnail = entry;
    } else if (name === 'export-asset' || name.includes('export')) {
      const fmt = String(file.filename || '').split('.').pop()?.toLowerCase() || '';
      if (['png', 'jpg', 'jpeg', 'webp'].includes(fmt) && !out.thumbnail) {
        out.thumbnail = entry;
      } else if (['pdf'].includes(fmt)) {
        out.capture = entry;
      } else {
        out.video = entry;
      }
    }
  }

  if (!out.video?.url && !out.capture?.url) {
    for (const task of tasks) {
      const files = task?.result?.files;
      if (Array.isArray(files) && files[0]?.url) {
        const url = String(files[0].url);
        if (!out.video) out.video = { url, filename: files[0].filename };
        break;
      }
    }
  }

  return out;
}

/**
 * @param {unknown} job
 */
export function extractCloudConvertError(job) {
  const tasks = Array.isArray(job?.tasks) ? job.tasks : [];
  const errTask = tasks.find((t) => String(t?.status || '') === 'error');
  if (errTask?.message) return String(errTask.message).slice(0, 500);
  if (errTask?.code) return String(errTask.code).slice(0, 200);
  return 'CloudConvert job failed';
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} payload
 */
export async function findMoviemodeJobForCloudConvertWebhook(env, payload) {
  const job = /** @type {any} */ (payload?.job || {});
  const externalId = job?.id != null ? String(job.id).trim() : '';
  const tag = job?.tag != null ? String(job.tag).trim() : '';

  if (tag && tag.startsWith('mmconv_')) {
    const byTag = await env.DB.prepare(
      `SELECT * FROM moviemode_conversion_jobs WHERE id = ? LIMIT 1`,
    )
      .bind(tag)
      .first();
    if (byTag) return byTag;
  }

  if (externalId) {
    const byExt = await env.DB.prepare(
      `SELECT * FROM moviemode_conversion_jobs WHERE external_job_id = ? LIMIT 1`,
    )
      .bind(externalId)
      .first();
    if (byExt) return byExt;

    const { results } = await env.DB.prepare(
      `SELECT * FROM moviemode_conversion_jobs
       WHERE service = 'cloudconvert' AND status IN ('queued','pending','running')
       ORDER BY created_at DESC LIMIT 50`,
    ).all();
    for (const row of results || []) {
      let meta = {};
      try {
        meta = JSON.parse(row.metadata_json || '{}');
      } catch {
        meta = {};
      }
      if (meta.cloudconvert_job_id === externalId) return row;
    }
  }

  return null;
}

/**
 * @param {any} env
 * @param {any} row
 * @param {string} objectKey
 * @param {{ mediaKind?: string, contentType?: string, sizeBytes?: number, role?: string }} opts
 * @param {unknown} ccJob
 */
async function registerR2OutputAsset(env, row, objectKey, opts, ccJob) {
  const workspaceId = String(row.workspace_id || '').trim();
  const tenantId = String(row.tenant_id || '').trim();
  if (!workspaceId || !tenantId || !objectKey) return null;

  let sizeBytes = opts.sizeBytes ?? 0;
  let contentType = opts.contentType || 'application/octet-stream';

  if (env.ASSETS?.head && sizeBytes <= 0) {
    try {
      const head = await env.ASSETS.head(objectKey);
      if (head) {
        sizeBytes = head.size || 0;
        contentType = head.httpMetadata?.contentType || contentType;
      }
    } catch {
      /* optional */
    }
  }

  const ext = objectKey.split('.').pop()?.toLowerCase() || 'bin';
  const assetId = `asset_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const meta = {
    cloudconvert_job_id: ccJob?.id || row.external_job_id,
    conversion_job_id: row.id,
    imported_from: 'cloudconvert_s3_export',
    role: opts.role || 'output',
  };

  await env.DB.prepare(
    `INSERT INTO media_assets (
       id, tenant_id, workspace_id, project_id, source_kind, source_uri,
       bucket, object_key, filename, content_type, media_kind, size_bytes, status, metadata_json
     ) VALUES (?, ?, ?, ?, 'cloudconvert', ?, 'inneranimalmedia', ?, ?, ?, ?, ?, 'uploaded', ?)
     ON CONFLICT(workspace_id, bucket, object_key) DO UPDATE SET
       size_bytes = excluded.size_bytes,
       metadata_json = excluded.metadata_json,
       updated_at = datetime('now')`,
  )
    .bind(
      assetId,
      tenantId,
      workspaceId,
      row.project_id || null,
      String(ccJob?.id || ''),
      objectKey,
      objectKey.split('/').pop() || `${row.id}.${ext}`,
      contentType,
      opts.mediaKind || 'video',
      sizeBytes,
      JSON.stringify(meta),
    )
    .run();

  return assetId;
}

/**
 * @param {any} env
 * @param {any} row
 * @param {string} outputUrl
 * @param {unknown} ccJob
 */
async function importCloudConvertOutputToR2(env, row, outputUrl, ccJob) {
  const workspaceId = String(row.workspace_id || '').trim();
  const tenantId = String(row.tenant_id || '').trim();
  if (!workspaceId || !tenantId || !env.ASSETS?.put) return;

  const res = await fetch(outputUrl);
  if (!res.ok) throw new Error(`export fetch HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  const ext = String(row.output_format || 'mp4').replace(/^\./, '') || 'mp4';
  const objectKey = `moviemode/${workspaceId}/${row.project_id || 'conversions'}/converted/${row.id}.${ext}`;

  await env.ASSETS.put(objectKey, bytes, { httpMetadata: { contentType } });

  const assetId = await registerR2OutputAsset(env, row, objectKey, {
    mediaKind: ext === 'png' || ext === 'jpg' ? 'image' : ext === 'pdf' ? 'document' : 'video',
    contentType,
    sizeBytes: bytes.byteLength,
    role: 'primary',
  }, ccJob);

  await env.DB.prepare(
    `UPDATE moviemode_conversion_jobs SET
       output_asset_id = ?,
       result_bucket = 'inneranimalmedia',
       result_object_key = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(assetId, objectKey, row.id)
    .run();

  await finalizeMoviemodeConversionJob(env, row.id, {
    status: 'complete',
    output_asset_id: assetId,
    result_bucket: 'inneranimalmedia',
    result_object_key: objectKey,
    output_url: outputUrl,
    external_job_id: row.external_job_id || ccJob?.id || null,
  });
}

/**
 * @param {any} env
 * @param {any} row
 * @param {Record<string, string>} r2Outputs
 * @param {unknown} ccJob
 */
async function finalizeS3DirectExports(env, row, r2Outputs, ccJob) {
  const artifacts = extractCloudConvertArtifacts(ccJob);
  let primaryAssetId = null;
  let primaryKey = null;

  if (r2Outputs.video) {
    primaryKey = r2Outputs.video;
    primaryAssetId = await registerR2OutputAsset(env, row, r2Outputs.video, {
      mediaKind: 'video',
      sizeBytes: artifacts.video?.size,
      role: 'primary',
    }, ccJob);
  } else if (r2Outputs.capture) {
    primaryKey = r2Outputs.capture;
    primaryAssetId = await registerR2OutputAsset(env, row, r2Outputs.capture, {
      mediaKind: 'document',
      contentType: r2Outputs.capture.endsWith('.png') ? 'image/png' : 'application/pdf',
      sizeBytes: artifacts.capture?.size,
      role: 'primary',
    }, ccJob);
  }

  if (r2Outputs.thumbnail) {
    await registerR2OutputAsset(env, row, r2Outputs.thumbnail, {
      mediaKind: 'image',
      contentType: 'image/png',
      sizeBytes: artifacts.thumbnail?.size,
      role: 'thumbnail',
    }, ccJob);
  }

  if (primaryAssetId && primaryKey) {
    await env.DB.prepare(
      `UPDATE moviemode_conversion_jobs SET
         output_asset_id = ?,
         result_bucket = 'inneranimalmedia',
         result_object_key = ?,
         updated_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(primaryAssetId, primaryKey, row.id)
      .run();

    await finalizeMoviemodeConversionJob(env, row.id, {
      status: 'complete',
      output_asset_id: primaryAssetId,
      result_bucket: 'inneranimalmedia',
      result_object_key: primaryKey,
      external_job_id: row.external_job_id || ccJob?.id || null,
    });
  }

  return { primaryAssetId, primaryKey };
}

/**
 * @param {any} env
 * @param {any} [ctx]
 * @param {Record<string, unknown>} payload
 */
export async function applyCloudConvertWebhookToMoviemode(env, ctx, payload) {
  const event = String(payload?.event || '').trim();
  const job = /** @type {any} */ (payload?.job || {});
  const externalId = job?.id != null ? String(job.id).trim() : null;

  if (!event || !externalId) {
    return { ok: false, reason: 'missing_event_or_job' };
  }

  const row = await findMoviemodeJobForCloudConvertWebhook(env, payload);
  if (!row) {
    return { ok: true, matched: false, event, external_job_id: externalId };
  }

  await env.DB.prepare(
    `UPDATE moviemode_conversion_jobs SET
       external_job_id = COALESCE(external_job_id, ?),
       updated_at = datetime('now'),
       progress_pct = CASE
         WHEN ? = 'job.created' THEN MAX(progress_pct, 10)
         WHEN ? = 'job.finished' THEN 100
         ELSE progress_pct
       END,
       status = CASE
         WHEN ? = 'job.created' THEN 'running'
         ELSE status
       END
     WHERE id = ?`,
  )
    .bind(externalId, event, event, event, row.id)
    .run();

  if (event === 'job.created') {
    return { ok: true, matched: true, conversion_job_id: row.id, status: 'running' };
  }

  if (event === 'job.failed') {
    const out = await finalizeMoviemodeConversionJob(env, row.id, {
      status: 'failed',
      external_job_id: externalId,
      error_message: extractCloudConvertError(job),
    });
    return { ok: true, matched: true, conversion_job_id: row.id, finalize: out };
  }

  if (event === 'job.finished') {
    let meta = {};
    try {
      meta = JSON.parse(row.metadata_json || '{}');
    } catch {
      meta = {};
    }

    const exportMode = String(meta.export_mode || '');
    const r2Outputs = meta.r2_outputs && typeof meta.r2_outputs === 'object' ? meta.r2_outputs : null;

    if (exportMode === 's3' && r2Outputs) {
      const s3Out = await finalizeS3DirectExports(env, row, r2Outputs, job);
      return {
        ok: true,
        matched: true,
        conversion_job_id: row.id,
        export_mode: 's3',
        ...s3Out,
      };
    }

    const artifacts = extractCloudConvertArtifacts(job);
    const outputUrl =
      artifacts.video?.url || artifacts.capture?.url || extractCloudConvertExportUrl(job);
    const out = await finalizeMoviemodeConversionJob(env, row.id, {
      status: 'complete',
      external_job_id: externalId,
      output_url: outputUrl,
    });

    if (outputUrl && ctx?.waitUntil) {
      ctx.waitUntil(
        importCloudConvertOutputToR2(env, row, outputUrl, job).catch((e) => {
          console.warn('[cloudconvert-webhook] r2 import', e?.message ?? e);
        }),
      );
    }

    if (artifacts.thumbnail?.url && ctx?.waitUntil) {
      ctx.waitUntil(
        importThumbnailSidecar(env, row, artifacts.thumbnail.url, job).catch((e) => {
          console.warn('[cloudconvert-webhook] thumb import', e?.message ?? e);
        }),
      );
    }

    return {
      ok: true,
      matched: true,
      conversion_job_id: row.id,
      output_url: outputUrl,
      artifacts,
      finalize: out,
      r2_import_scheduled: Boolean(outputUrl && ctx?.waitUntil),
    };
  }

  return { ok: true, matched: true, conversion_job_id: row.id, event, ignored: true };
}

/**
 * @param {any} env
 * @param {any} row
 * @param {string} thumbUrl
 * @param {unknown} ccJob
 */
async function importThumbnailSidecar(env, row, thumbUrl, ccJob) {
  const workspaceId = String(row.workspace_id || '').trim();
  if (!workspaceId || !env.ASSETS?.put) return;

  const res = await fetch(thumbUrl);
  if (!res.ok) return;
  const bytes = await res.arrayBuffer();
  const objectKey = `moviemode/${workspaceId}/${row.project_id || 'conversions'}/converted/${row.id}-poster.png`;
  await env.ASSETS.put(objectKey, bytes, { httpMetadata: { contentType: 'image/png' } });
  await registerR2OutputAsset(env, row, objectKey, {
    mediaKind: 'image',
    contentType: 'image/png',
    sizeBytes: bytes.byteLength,
    role: 'thumbnail',
  }, ccJob);
}

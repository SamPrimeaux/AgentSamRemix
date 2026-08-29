/**
 * MovieMode render output — ARTIFACTS bucket + D1 registry (agentsam_artifacts, media_assets, moviemode_exports).
 */
import { pragmaTableInfo } from '../../backend/services/retention.js';
import {
  buildArtifactR2Key,
  defaultArtifactBucket,
  normalizeArtifactFormat,
  resolveArtifactR2Binding,
} from './artifact-key.js';
import { artifactPublicUrl } from './artifact-r2-store.js';
import { buildMoviemodeR2Prefix } from '../api/moviemode-api.js';

function newArtifactId() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return `art_${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function newExportId() {
  return `mmexp_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function newAssetId() {
  return `asset_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function mimeFromFilename(filename) {
  const ext = String(filename || '').split('.').pop()?.toLowerCase() || 'mp4';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'gif') return 'image/gif';
  return 'video/mp4';
}

/**
 * Prefer explicit userId; else workspace owner / first active member.
 * @param {any} env
 * @param {{ userId?: string|null, workspaceId?: string|null }} opts
 */
export async function resolveVeoArtifactUserId(env, opts = {}) {
  const fromJob = String(opts.userId || '').trim();
  if (fromJob) return fromJob;
  const workspaceId = String(opts.workspaceId || '').trim();
  if (!env?.DB || !workspaceId) return '';
  const owner = await env.DB.prepare(
    `SELECT user_id FROM workspace_members
     WHERE workspace_id = ?
       AND LOWER(COALESCE(role, '')) = 'owner'
       AND COALESCE(is_active, 1) = 1
     LIMIT 1`,
  )
    .bind(workspaceId)
    .first()
    .catch(() => null);
  if (owner?.user_id) return String(owner.user_id).trim();
  const any = await env.DB.prepare(
    `SELECT user_id FROM workspace_members
     WHERE workspace_id = ? AND COALESCE(is_active, 1) = 1
     ORDER BY joined_at ASC
     LIMIT 1`,
  )
    .bind(workspaceId)
    .first()
    .catch(() => null);
  return any?.user_id ? String(any.user_id).trim() : '';
}

/**
 * Persist MovieMode binary output to ARTIFACTS and register D1 rows.
 *
 * @param {any} env
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {{
 *   jobId?: string,
 *   filename: string,
 *   contentType?: string,
 *   workspaceId: string,
 *   tenantId: string,
 *   userId?: string,
 *   projectId?: string,
 *   projectSlug?: string,
 *   variantType?: string,
 *   renderJobId?: string,
 *   width?: number,
 *   height?: number,
 *   fps?: number,
 *   durationMs?: number,
 *   destination?: 'local'|'stream',
 *   metadataExtra?: Record<string, unknown>,
 * }} meta
 */
export async function finalizeMoviemodeOutput(env, buffer, meta) {
  const workspaceId = String(meta.workspaceId || '').trim();
  const tenantId = String(meta.tenantId || '').trim();
  let userId = String(meta.userId || '').trim();
  if (!workspaceId || !tenantId) {
    throw new Error('workspace_id and tenant_id required');
  }
  if (!userId) {
    userId = await resolveVeoArtifactUserId(env, { workspaceId });
  }
  if (!userId) {
    throw new Error('workspace_id, tenant_id, and user_id required');
  }

  const bucketName = defaultArtifactBucket();
  const bucket = resolveArtifactR2Binding(env, bucketName);
  if (!bucket?.put) throw new Error('ARTIFACTS binding not configured');

  const filename = String(meta.filename || 'export.mp4').trim();
  const contentType = meta.contentType || mimeFromFilename(filename);
  const artifactId = newArtifactId();
  const r2Key = buildArtifactR2Key({
    userId,
    kind: 'export',
    artifactId,
    format: 'video',
  });
  if (!r2Key) throw new Error('invalid artifact key');

  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  await bucket.put(r2Key, bytes, {
    httpMetadata: { contentType },
    customMetadata: {
      source: 'moviemode',
      job_id: String(meta.jobId || ''),
    },
  });

  const sizeBytes = bytes.byteLength;
  const origin = String(env.IAM_ORIGIN || 'https://inneranimalmedia.com').replace(/\/$/, '');
  const publicUrl = artifactPublicUrl(artifactId, origin);
  const variantType = String(meta.variantType || 'custom').trim() || 'custom';
  let projectId = String(meta.projectId || '').trim();
  if (env.DB) {
    const { ensureMoviemodeExportProject } = await import('./moviemode-projects.js');
    projectId = projectId || (await ensureMoviemodeExportProject(env, { tenantId, workspaceId }));
  } else if (!projectId) {
    projectId = `mmproj_export_${workspaceId.slice(0, 12)}`;
  }
  const exportId = newExportId();
  const assetId = newAssetId();
  const renderJobId = meta.renderJobId
    ? String(meta.renderJobId).trim()
    : meta.jobId
      ? `mmrender_${meta.jobId}`
      : null;

  if (env.DB) {
    // Lane law: moviemode_exports + media_assets are canonical for MovieMode outputs.
    // agentsam_artifacts is an optional cross-surface mirror (source=moviemode_export only).
    const cols = await pragmaTableInfo(env.DB, 'agentsam_artifacts');
    if (cols.size) {
      const artRow = {
        id: artifactId,
        user_id: userId || null,
        tenant_id: tenantId,
        workspace_id: workspaceId,
        name: filename.slice(0, 500),
        description: 'MovieMode export',
        artifact_type: normalizeArtifactFormat('video'),
        artifact_status: 'draft',
        r2_key: r2Key,
        public_url: publicUrl,
        source: 'moviemode_export',
        file_size_bytes: sizeBytes,
        is_public: 0,
        scope: 'workspace',
        r2_bucket: bucketName,
        metadata_json: JSON.stringify({
          kind: 'export',
          job_id: meta.jobId || null,
          project_id: projectId,
          destination: meta.destination || 'local',
          ...(meta.metadataExtra && typeof meta.metadataExtra === 'object' ? meta.metadataExtra : {}),
        }),
      };
      const names = [];
      const ph = [];
      const binds = [];
      for (const [k, v] of Object.entries(artRow)) {
        if (v === undefined || !cols.has(k.toLowerCase())) continue;
        names.push(k);
        ph.push('?');
        binds.push(v);
      }
      if (names.length) {
        await env.DB.prepare(
          `INSERT INTO agentsam_artifacts (${names.join(', ')}) VALUES (${ph.join(', ')})`,
        )
          .bind(...binds)
          .run()
          .catch((e) => console.warn('[moviemode] agentsam_artifacts insert', e?.message));
      }
    }

    await env.DB.prepare(
      `INSERT INTO media_assets (id, tenant_id, workspace_id, project_id, bucket, object_key, filename, content_type, media_kind, size_bytes, status, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'video', ?, 'uploaded', ?)
       ON CONFLICT(workspace_id, bucket, object_key) DO UPDATE SET
         size_bytes = excluded.size_bytes,
         content_type = excluded.content_type,
         status = 'uploaded',
         updated_at = datetime('now')`,
    )
      .bind(
        assetId,
        tenantId,
        workspaceId,
        projectId,
        bucketName,
        r2Key,
        filename,
        contentType,
        sizeBytes,
        JSON.stringify({
          artifact_id: artifactId,
          job_id: meta.jobId || null,
          destination: meta.destination || 'local',
          ...(meta.metadataExtra && typeof meta.metadataExtra === 'object' ? meta.metadataExtra : {}),
        }),
      )
      .run()
      .catch((e) => console.warn('[moviemode] media_assets insert', e?.message));

    const moviemodePrefix = meta.projectSlug
      ? buildMoviemodeR2Prefix(workspaceId, meta.projectSlug)
      : null;

    await env.DB.prepare(
      `INSERT INTO moviemode_exports (id, tenant_id, workspace_id, project_id, render_job_id, variant_type, bucket, object_key, public_url, content_type, size_bytes, width, height, fps, duration_ms, status, artifact_id, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)
       ON CONFLICT(workspace_id, bucket, object_key) DO UPDATE SET
         size_bytes = excluded.size_bytes,
         public_url = excluded.public_url,
         status = 'ready',
         artifact_id = excluded.artifact_id,
         metadata_json = excluded.metadata_json`,
    )
      .bind(
        exportId,
        tenantId,
        workspaceId,
        projectId,
        renderJobId,
        variantType,
        bucketName,
        r2Key,
        publicUrl,
        contentType,
        sizeBytes,
        meta.width ?? null,
        meta.height ?? null,
        meta.fps ?? null,
        meta.durationMs ?? null,
        artifactId,
        JSON.stringify({
          artifact_id: artifactId,
          asset_id: assetId,
          job_id: meta.jobId || null,
          moviemode_prefix: moviemodePrefix,
        }),
      )
      .run()
      .catch((e) => console.warn('[moviemode] moviemode_exports insert', e?.message));

    if (renderJobId) {
      await env.DB.prepare(
        `UPDATE moviemode_render_jobs SET
           status = 'complete',
           progress_pct = 100,
           output_json = ?,
           completed_at = datetime('now'),
           updated_at = datetime('now')
         WHERE id = ? AND workspace_id = ?`,
      )
        .bind(
          JSON.stringify({
            r2_key: r2Key,
            artifact_id: artifactId,
            export_id: exportId,
            asset_id: assetId,
            bucket: bucketName,
          }),
          renderJobId,
          workspaceId,
        )
        .run()
        .catch((e) => console.warn('[moviemode] render_jobs update', e?.message));
    }
  }

  return {
    ok: true,
    artifact_id: artifactId,
    asset_id: assetId,
    export_id: exportId,
    r2_key: r2Key,
    bucket: bucketName,
    public_url: publicUrl,
    size_bytes: sizeBytes,
  };
}

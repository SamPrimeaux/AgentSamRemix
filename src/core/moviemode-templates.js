/**
 * MovieMode platform + workspace templates (moviemode_templates lane).
 */

/**
 * @param {unknown} env
 * @param {string} workspaceId
 * @param {{ pack?: string }} [opts]
 */
export async function listMoviemodeTemplates(env, workspaceId, opts = {}) {
  const pack = opts.pack ? String(opts.pack).trim() : null;
  let sql = `SELECT * FROM moviemode_templates
    WHERE status = 'active' AND (scope = 'platform' OR workspace_id = ?)`;
  const binds = [workspaceId];
  if (pack) {
    sql += ` AND pack_slug = ?`;
    binds.push(pack);
  }
  sql += ` ORDER BY pack_slug, sort_order ASC, title ASC LIMIT 100`;
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return results || [];
}

/**
 * Import Stream clip + register media_assets when applying a platform template.
 * @param {unknown} env
 * @param {{ workspaceId: string, tenantId: string, userId?: string }} auth
 * @param {string} templateId
 * @param {{ project_id?: string, project_slug?: string, import_stream?: boolean }} [opts]
 */
export async function applyMoviemodeTemplate(env, auth, templateId, opts = {}) {
  const workspaceId = String(auth.workspaceId || '').trim();
  const tenantId = String(auth.tenantId || '').trim();
  const id = String(templateId || '').trim();

  const tpl = await env.DB.prepare(
    `SELECT * FROM moviemode_templates
     WHERE id = ? AND status = 'active'
       AND (scope = 'platform' OR workspace_id = ?)
     LIMIT 1`,
  )
    .bind(id, workspaceId)
    .first();
  if (!tpl) throw new Error('template not found');

  let meta = {};
  try {
    meta = JSON.parse(tpl.metadata_json || '{}');
  } catch {
    meta = {};
  }

  let asset = null;
  const streamUid = tpl.stream_uid ? String(tpl.stream_uid).trim() : '';
  const shouldImport = opts.import_stream !== false && streamUid;

  if (shouldImport) {
    const projectSlug = String(opts.project_slug || tpl.pack_slug || 'templates').trim();
    const filename =
      meta.source_filename || `${tpl.slug || 'clip'}.mp4`;
    const objectKey = `moviemode/${workspaceId}/${projectSlug}/source/templates/${tpl.slug}/${filename}`;

    const { importStreamVideoToR2 } = await import('../../backend/services/media/cloudflare-stream-api.js');
    const copied = await importStreamVideoToR2(env, { uid: streamUid, objectKey });

    const assetId = `asset_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const durationMs =
      tpl.duration_sec != null ? Math.round(Number(tpl.duration_sec) * 1000) : null;

    await env.DB.prepare(
      `INSERT INTO media_assets (
         id, tenant_id, workspace_id, project_id, source_kind, source_uri,
         bucket, object_key, filename, content_type, media_kind, size_bytes,
         duration_ms, status, metadata_json
       ) VALUES (?, ?, ?, ?, 'stream', ?, ?, ?, ?, ?, 'video', ?, ?, 'uploaded', ?)
       ON CONFLICT(workspace_id, bucket, object_key) DO UPDATE SET
         updated_at = datetime('now'),
         metadata_json = excluded.metadata_json`,
    )
      .bind(
        assetId,
        tenantId,
        workspaceId,
        opts.project_id || null,
        streamUid,
        copied.bucket,
        copied.object_key,
        filename,
        copied.content_type,
        copied.size_bytes,
        durationMs,
        JSON.stringify({
          ...meta,
          template_id: tpl.id,
          pack_slug: tpl.pack_slug,
          stream_uid: streamUid,
          stream_hls_url: tpl.stream_hls_url,
        }),
      )
      .run();

    asset = await env.DB.prepare(
      `SELECT * FROM media_assets WHERE workspace_id = ? AND bucket = ? AND object_key = ? LIMIT 1`,
    )
      .bind(workspaceId, copied.bucket, copied.object_key)
      .first();

    if (asset && env._ctx?.waitUntil) {
      env._ctx.waitUntil(
        import('./moviemode-whisper.js').then(({ transcribeAndReindexMediaAsset }) =>
          transcribeAndReindexMediaAsset(env, asset),
        ),
      );
    }
  }

  return {
    template: tpl,
    asset,
    preview_url: asset
      ? `/api/r2/buckets/${encodeURIComponent(asset.bucket)}/object/${encodeURIComponent(asset.object_key)}`
      : tpl.stream_hls_url || null,
  };
}

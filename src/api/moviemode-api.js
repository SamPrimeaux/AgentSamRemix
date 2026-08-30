/**
 * MovieMode / media registry API — Worker orchestrates; encode runs on dock host.
 */
import { getAuthUser, jsonResponse } from '../core/auth.js';
import { isDashboardMediaBucket } from './r2-api.js';
import { resolveMoviemodeKv } from '../core/moviemode-kv.js';
import {
  parseMoviemodeExportExecLane,
  startRemotionRender,
} from '../core/moviemode-render-dispatch.js';

async function requireAuth(request, env) {
  const authUser = await getAuthUser(request, env);
  if (!authUser) return { error: jsonResponse({ error: 'Unauthorized' }, 401) };
  const workspaceId = authUser.active_workspace_id || authUser.workspace_id || null;
  const tenantId = authUser.tenant_id || authUser.active_tenant_id || null;
  if (!workspaceId || !tenantId) {
    return { error: jsonResponse({ error: 'workspace_id and tenant_id required' }, 400) };
  }
  return { authUser, workspaceId: String(workspaceId), tenantId: String(tenantId) };
}

export function buildMoviemodeR2Prefix(workspaceId, projectSlug) {
  return `moviemode/${workspaceId}/${projectSlug}`;
}

function bodyDeleteR2Allowed(objectKey) {
  const key = String(objectKey || '').trim();
  if (!key) return false;
  return (
    key.startsWith('moviemode/') ||
    key.startsWith('users/') ||
    key.startsWith('workspace-media/') ||
    key.startsWith('uploads/') ||
    key.startsWith('media/')
  );
}

/** Gemini multimodal media lane — POST /api/agentsam/video-embed or /api/moviemode/embed */
export async function handleVideoEmbedRequest(request, env, { workspaceId }) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const assetId = String(body.asset_id || body.id || '').trim();
  if (!assetId) return jsonResponse({ error: 'asset_id required' }, 400);

  const row = await env.DB.prepare(
    `SELECT * FROM media_assets WHERE id = ? AND workspace_id = ? LIMIT 1`,
  )
    .bind(assetId, workspaceId)
    .first();
  if (!row) return jsonResponse({ error: 'Not found' }, 404);

  const { transcriptFromAssetRow } = await import('../core/moviemode-whisper.js');
  const transcript =
    body.transcript != null ? String(body.transcript || '').trim() || null : transcriptFromAssetRow(row);

  try {
    const { indexMediaAssetForSearch } = await import('../core/moviemode-media-vectorize.js');
    const indexed = await indexMediaAssetForSearch(env, row, {
      caption: body.caption || body.description || null,
      transcript,
      force: body.force !== false,
    });
    return jsonResponse({
      ok: true,
      asset_id: assetId,
      lane: 'moviemode_media',
      embed_model: indexed?.model ?? null,
      index: indexed,
    });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e?.message || e).slice(0, 400) }, 502);
  }
}

export async function handleMoviemodeApi(request, url, env, ctx) {
  if (ctx) env._ctx = ctx;
  const path = url.pathname.replace(/\/$/, '') || '/';
  const method = (request.method || 'GET').toUpperCase();
  if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);

  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;
  const { workspaceId, tenantId, authUser } = auth;
  const userId = authUser?.id != null ? String(authUser.id).trim() : '';

  if (
    path.startsWith('/api/stream/videos/') ||
    path === '/api/stream/from-url' ||
    path === '/api/stream/direct-upload' ||
    path === '/api/stream/capabilities'
  ) {
    const { handleStreamVideosDetailApi } = await import('./stream-videos-api.js');
    const res = await handleStreamVideosDetailApi(request, url, env, ctx, {
      workspaceId,
      tenantId,
      userId,
    });
    if (res) return res;
  }

  if (path === '/api/moviemode/projects' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT * FROM moviemode_projects WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 100`,
    )
      .bind(workspaceId)
      .all();
    return jsonResponse({ projects: results || [] });
  }

  if (path === '/api/moviemode/projects' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const slug = String(body.slug || '').trim();
    const title = String(body.title || '').trim();
    if (!slug || !title) return jsonResponse({ error: 'slug and title required' }, 400);
    const id = `mmproj_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const r2_prefix = buildMoviemodeR2Prefix(workspaceId, slug);
    await env.DB.prepare(
      `INSERT INTO moviemode_projects (id, tenant_id, workspace_id, slug, title, client_name, brief_text, brand_json, target_json, r2_prefix, plan_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        tenantId,
        workspaceId,
        slug,
        title,
        body.client_name || null,
        body.brief_text || null,
        JSON.stringify(body.brand || {}),
        JSON.stringify(body.target || {}),
        r2_prefix,
        body.plan_id || null,
      )
      .run();
    return jsonResponse({ ok: true, id, r2_prefix });
  }

  const projectMatch = path.match(/^\/api\/moviemode\/projects\/([^/]+)$/);
  if (projectMatch && method === 'GET') {
    const id = decodeURIComponent(projectMatch[1]);
    const row = await env.DB.prepare(
      `SELECT * FROM moviemode_projects WHERE id = ? AND workspace_id = ? LIMIT 1`,
    )
      .bind(id, workspaceId)
      .first();
    if (!row) return jsonResponse({ error: 'Not found' }, 404);
    return jsonResponse({ project: row });
  }

  if (path === '/api/media/assets' && method === 'GET') {
    const projectId = url.searchParams.get('project_id');
    const mediaKind = url.searchParams.get('media_kind');
    const q = url.searchParams.get('q');
    let sql = `SELECT * FROM media_assets WHERE workspace_id = ?`;
    const binds = [workspaceId];
    if (projectId) {
      sql += ` AND project_id = ?`;
      binds.push(projectId);
    }
    if (mediaKind) {
      sql += ` AND media_kind = ?`;
      binds.push(String(mediaKind).trim().toLowerCase());
    }
    if (q) {
      sql += ` AND (filename LIKE ? OR object_key LIKE ? OR metadata_json LIKE ?)`;
      const like = `%${String(q).trim()}%`;
      binds.push(like, like, like);
    }
    sql += ` ORDER BY updated_at DESC LIMIT 200`;
    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return jsonResponse({ assets: results || [] });
  }

  const mediaAssetMatch = path.match(/^\/api\/media\/assets\/([^/]+)$/);
  if (mediaAssetMatch && method === 'PATCH') {
    const assetId = decodeURIComponent(mediaAssetMatch[1]);
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const row = await env.DB.prepare(
      `SELECT * FROM media_assets WHERE id = ? AND workspace_id = ? LIMIT 1`,
    )
      .bind(assetId, workspaceId)
      .first();
    if (!row) return jsonResponse({ error: 'Not found' }, 404);

    let meta = {};
    try {
      meta = JSON.parse(row.metadata_json || '{}');
    } catch {
      meta = {};
    }
    if (body.metadata && typeof body.metadata === 'object') {
      meta = { ...meta, ...body.metadata };
    }
    if (body.tags) meta.tags = body.tags;
    if (body.stream_uid) meta.stream_uid = String(body.stream_uid);

    const filename =
      body.filename != null ? String(body.filename).trim() || row.filename : row.filename;
    const projectId =
      body.project_id !== undefined ? body.project_id || null : row.project_id;

    await env.DB.prepare(
      `UPDATE media_assets SET
         filename = ?,
         project_id = ?,
         metadata_json = ?,
         updated_at = datetime('now')
       WHERE id = ? AND workspace_id = ?`,
    )
      .bind(filename, projectId, JSON.stringify(meta), assetId, workspaceId)
      .run();

    const updated = await env.DB.prepare(
      `SELECT * FROM media_assets WHERE id = ? AND workspace_id = ? LIMIT 1`,
    )
      .bind(assetId, workspaceId)
      .first();
    return jsonResponse({ ok: true, asset: updated });
  }

  if (mediaAssetMatch && method === 'DELETE') {
    const assetId = decodeURIComponent(mediaAssetMatch[1]);
    const row = await env.DB.prepare(
      `SELECT * FROM media_assets WHERE id = ? AND workspace_id = ? LIMIT 1`,
    )
      .bind(assetId, workspaceId)
      .first();
    if (!row) return jsonResponse({ error: 'Not found' }, 404);

    if (isDashboardMediaBucket(row.bucket) && env.ASSETS && bodyDeleteR2Allowed(row.object_key)) {
      try {
        await env.ASSETS.delete(String(row.object_key));
      } catch {
        /* best-effort */
      }
    }
    await env.DB.prepare(`DELETE FROM media_assets WHERE id = ? AND workspace_id = ?`)
      .bind(assetId, workspaceId)
      .run();
    return jsonResponse({ ok: true, id: assetId });
  }

  if (path === '/api/stream/videos' && method === 'GET') {
    const { handleStreamVideosList } = await import('./stream-videos-api.js');
    const limit = Math.min(Number(url.searchParams.get('limit') || 100), 100);
    return handleStreamVideosList(
      env,
      { workspaceId, tenantId, userId },
      { limit },
    );
  }

  if (path === '/api/stream/import' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const streamUid = String(body.stream_uid || body.uid || '').trim();
    if (!streamUid) return jsonResponse({ error: 'stream_uid required' }, 400);

    const projectSlug = String(body.project_slug || body.slug || 'imports').trim() || 'imports';
    const filename = String(body.filename || `${streamUid}.mp4`).trim();
    const objectKey =
      String(body.object_key || '').trim() ||
      `moviemode/${workspaceId}/${projectSlug}/source/stream/${streamUid}/${filename}`;

    try {
      const { resolveCfStreamContext, streamContextErrorResponse } = await import(
        undefined
      );
      const streamCtx = await resolveCfStreamContext(env, {
        userId,
        workspaceId,
        requireWrite: false,
      });
      if (!streamCtx.ok) return streamContextErrorResponse(streamCtx, jsonResponse);

      const {
        importStreamVideoToR2,
        assertStreamUidInAccount,
        mapStreamVideoRow,
        upsertStreamMediaAsset,
      } = await import('../../backend/services/media/cloudflare-stream-api.js');
      const video = await assertStreamUidInAccount(env, streamCtx, streamUid);
      const copied = await importStreamVideoToR2(env, streamCtx, { uid: streamUid, objectKey });

      const id = `asset_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
      const streamMeta = {
        stream_uid: streamUid,
        imported_from: 'cloudflare_stream',
        ...mapStreamVideoRow(video, streamCtx.accountId),
      };

      const durationMs =
        streamMeta.duration_sec != null
          ? Math.round(Number(streamMeta.duration_sec) * 1000)
          : null;

      await env.DB.prepare(
        `INSERT INTO media_assets (
           id, tenant_id, workspace_id, project_id, source_kind, source_uri,
           bucket, object_key, filename, content_type, media_kind, size_bytes,
           duration_ms, status, stream_uid, cloudflare_account_id,
           provider_credential_source, created_by_user_id, created_from_workspace_id,
           provider_status, metadata_json
         ) VALUES (?, ?, ?, ?, 'stream', ?, ?, ?, ?, ?, 'video', ?, ?, 'uploaded', ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, bucket, object_key) DO UPDATE SET
           size_bytes = excluded.size_bytes,
           stream_uid = excluded.stream_uid,
           cloudflare_account_id = excluded.cloudflare_account_id,
           metadata_json = excluded.metadata_json,
           updated_at = datetime('now')`,
      )
        .bind(
          id,
          tenantId,
          workspaceId,
          null,
          `stream://${streamUid}`,
          copied.bucket,
          copied.object_key,
          filename,
          copied.content_type || 'video/mp4',
          copied.size_bytes ?? null,
          durationMs,
          streamUid,
          streamCtx.accountId,
          streamCtx.source,
          userId || null,
          workspaceId,
          'ready',
          JSON.stringify(streamMeta),
        )
        .run();

      await upsertStreamMediaAsset(env, {
        streamCtx,
        video,
        userId,
        workspaceId,
        tenantId,
      });

      return jsonResponse({
        ok: true,
        asset_id: id,
        stream_uid: streamUid,
        account_id: streamCtx.accountId,
        r2: copied,
      });
    } catch (e) {
      return jsonResponse({ ok: false, error: String(e?.message || e).slice(0, 400) }, 502);
    }
  }

  if (path === '/api/stream/live-inputs' && method === 'GET') {
    try {
      const { listMoviemodeLiveInputs } = await import('../../backend/services/media/moviemode-live-inputs.js');
      const projectId = url.searchParams.get('project_id');
      const live_inputs = await listMoviemodeLiveInputs(env, workspaceId, {
        project_id: projectId,
        limit: Number(url.searchParams.get('limit') || 50),
      });
      return jsonResponse({ ok: true, live_inputs });
    } catch (e) {
      return jsonResponse({ ok: false, error: String(e?.message || e).slice(0, 400) }, 502);
    }
  }

  if (path === '/api/stream/live-inputs' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const name = String(body.name || body.title || '').trim();
    if (!name) return jsonResponse({ error: 'name required' }, 400);
    try {
      const { createMoviemodeLiveInput } = await import('../../backend/services/media/moviemode-live-inputs.js');
      const out = await createMoviemodeLiveInput(
        env,
        { workspaceId, tenantId, userId },
        {
          name,
          project_id: body.project_id || null,
          recording_mode: body.recording_mode || 'automatic',
        },
      );
      return jsonResponse({ ok: true, ...out });
    } catch (e) {
      return jsonResponse({ ok: false, error: String(e?.message || e).slice(0, 400) }, 502);
    }
  }

  const liveInputMatch = path.match(/^\/api\/stream\/live-inputs\/([^/]+)$/);
  if (liveInputMatch && method === 'GET') {
    const id = decodeURIComponent(liveInputMatch[1]);
    const row = await env.DB.prepare(
      `SELECT * FROM moviemode_live_inputs WHERE workspace_id = ? AND (id = ? OR stream_live_input_uid = ?) LIMIT 1`,
    )
      .bind(workspaceId, id, id)
      .first();
    if (!row) return jsonResponse({ error: 'Not found' }, 404);
    const { serializeLiveInputRow } = await import('../../backend/services/media/moviemode-live-inputs.js');
    return jsonResponse({ ok: true, live_input: serializeLiveInputRow(row) });
  }

  if (liveInputMatch && method === 'DELETE') {
    const id = decodeURIComponent(liveInputMatch[1]);
    const row = await env.DB.prepare(
      `SELECT * FROM moviemode_live_inputs WHERE workspace_id = ? AND (id = ? OR stream_live_input_uid = ?) LIMIT 1`,
    )
      .bind(workspaceId, id, id)
      .first();
    if (!row) return jsonResponse({ error: 'Not found' }, 404);
    try {
      const { deleteLiveInput } = await import('../../backend/services/media/cloudflare-stream-api.js');
      await deleteLiveInput(env, row.stream_live_input_uid);
    } catch (e) {
      console.warn('[live-input] cf delete', e?.message ?? e);
    }
    await env.DB.prepare(
      `UPDATE moviemode_live_inputs SET status = 'archived', updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(row.id)
      .run();
    return jsonResponse({ ok: true, id: row.id });
  }

  if (path === '/api/stream/webhook' && method === 'GET') {
    try {
      const { getStreamWebhook } = await import('../../backend/services/media/cloudflare-stream-api.js');
      const webhook = await getStreamWebhook(env);
      return jsonResponse({
        ok: true,
        webhook,
        endpoints: {
          vod: 'https://inneranimalmedia.com/api/webhooks/stream/vod',
          live: 'https://inneranimalmedia.com/api/webhooks/stream/live',
        },
      });
    } catch (e) {
      return jsonResponse({ ok: false, error: String(e?.message || e).slice(0, 400) }, 502);
    }
  }

  if (path === '/api/stream/webhook/install' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const notificationUrl =
      String(body.notification_url || body.notificationUrl || '').trim() ||
      'https://inneranimalmedia.com/api/webhooks/stream/vod';
    try {
      const { putStreamWebhook } = await import('../../backend/services/media/cloudflare-stream-api.js');
      const result = await putStreamWebhook(env, notificationUrl);
      return jsonResponse({
        ok: true,
        webhook: result,
        note: 'Store result.secret as CLOUDFLARE_STREAM_WEBHOOK_SECRET on the Worker.',
      });
    } catch (e) {
      return jsonResponse({ ok: false, error: String(e?.message || e).slice(0, 400) }, 502);
    }
  }

  if (path === '/api/moviemode/templates' && method === 'GET') {
    try {
      const { listMoviemodeTemplates } = await import('../core/moviemode-templates.js');
      const pack = url.searchParams.get('pack');
      const templates = await listMoviemodeTemplates(env, workspaceId, { pack });
      return jsonResponse({ ok: true, templates });
    } catch (e) {
      return jsonResponse({ ok: false, error: String(e?.message || e).slice(0, 400) }, 502);
    }
  }

  const templateApplyMatch = path.match(/^\/api\/moviemode\/templates\/([^/]+)\/apply$/);
  if (templateApplyMatch && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const templateId = decodeURIComponent(templateApplyMatch[1]);
    try {
      const { applyMoviemodeTemplate } = await import('../core/moviemode-templates.js');
      const out = await applyMoviemodeTemplate(
        env,
        { workspaceId, tenantId, userId },
        templateId,
        body,
      );
      return jsonResponse({ ok: true, ...out });
    } catch (e) {
      return jsonResponse({ ok: false, error: String(e?.message || e).slice(0, 400) }, 502);
    }
  }

  if (path === '/api/moviemode/conversions' && method === 'GET') {
    const status = url.searchParams.get('status');
    let sql = `SELECT * FROM moviemode_conversion_jobs WHERE workspace_id = ?`;
    const binds = [workspaceId];
    if (status) {
      sql += ` AND status = ?`;
      binds.push(String(status).trim());
    }
    sql += ` ORDER BY created_at DESC LIMIT 50`;
    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return jsonResponse({ jobs: results || [] });
  }

  if (path === '/api/moviemode/conversions' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    try {
      const { enqueueMoviemodeConversion } = await import('../core/moviemode-conversions.js');
      const job = await enqueueMoviemodeConversion(env, { workspaceId, tenantId, userId }, body);
      return jsonResponse({ ok: true, job });
    } catch (e) {
      return jsonResponse({ ok: false, error: String(e?.message || e).slice(0, 400) }, 400);
    }
  }

  const conversionMatch = path.match(/^\/api\/moviemode\/conversions\/([^/]+)$/);
  if (conversionMatch && method === 'GET') {
    const id = decodeURIComponent(conversionMatch[1]);
    const job = await env.DB.prepare(
      `SELECT * FROM moviemode_conversion_jobs WHERE id = ? AND workspace_id = ? LIMIT 1`,
    )
      .bind(id, workspaceId)
      .first();
    if (!job) return jsonResponse({ error: 'Not found' }, 404);
    const { results: history } = await env.DB.prepare(
      `SELECT * FROM moviemode_conversions WHERE conversion_job_id = ? ORDER BY created_at DESC LIMIT 10`,
    )
      .bind(id)
      .all();
    return jsonResponse({ job, history: history || [] });
  }

  if (conversionMatch && method === 'PATCH') {
    const id = decodeURIComponent(conversionMatch[1]);
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const owned = await env.DB.prepare(
      `SELECT id FROM moviemode_conversion_jobs WHERE id = ? AND workspace_id = ? LIMIT 1`,
    )
      .bind(id, workspaceId)
      .first();
    if (!owned) return jsonResponse({ error: 'Not found' }, 404);
    const bridgeKey = request.headers.get('X-Bridge-Key');
    const isBridge = env.AGENTSAM_BRIDGE_KEY && bridgeKey === env.AGENTSAM_BRIDGE_KEY;
    if (!isBridge && body.status && !['cancelled'].includes(String(body.status))) {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }
    try {
      const { finalizeMoviemodeConversionJob } = await import('../core/moviemode-conversions.js');
      const out = await finalizeMoviemodeConversionJob(env, id, body);
      return jsonResponse(out);
    } catch (e) {
      return jsonResponse({ ok: false, error: String(e?.message || e).slice(0, 400) }, 400);
    }
  }

  if (path === '/api/media/assets/register' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const bucketName = body.bucket || body.bucketName;
    if (!isDashboardMediaBucket(bucketName)) {
      return jsonResponse({ error: 'Invalid or disallowed bucket' }, 403);
    }
    const bucket = String(bucketName || '').trim();
    const object_key = String(body.object_key || body.key || '').trim();
    if (!object_key) return jsonResponse({ error: 'object_key required' }, 400);
    const id = `asset_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    await env.DB.prepare(
      `INSERT INTO media_assets (id, tenant_id, workspace_id, project_id, bucket, object_key, filename, content_type, media_kind, size_bytes, etag, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'registered')
       ON CONFLICT(workspace_id, bucket, object_key) DO UPDATE SET
         content_type = excluded.content_type,
         media_kind = excluded.media_kind,
         size_bytes = excluded.size_bytes,
         etag = excluded.etag,
         status = 'uploaded',
         updated_at = datetime('now')`,
    )
      .bind(
        id,
        tenantId,
        workspaceId,
        body.project_id || null,
        bucket,
        object_key,
        body.filename || object_key.split('/').pop(),
        body.content_type || null,
        body.media_kind || 'unknown',
        body.size_bytes ?? null,
        body.etag || null,
      )
      .run();

    const row = await env.DB.prepare(
      `SELECT * FROM media_assets WHERE workspace_id = ? AND bucket = ? AND object_key = ? LIMIT 1`,
    )
      .bind(workspaceId, bucket, object_key)
      .first();

    const mediaKind = String(row?.media_kind || body.media_kind || '').trim().toLowerCase();
    const shouldTranscribe =
      body.transcribe !== false && (mediaKind === 'video' || mediaKind === 'audio');
    if (shouldTranscribe && row && env._ctx?.waitUntil) {
      env._ctx.waitUntil(
        import('../core/moviemode-whisper.js').then(({ transcribeAndReindexMediaAsset }) =>
          transcribeAndReindexMediaAsset(env, row),
        ),
      );
    }

    const indexForSearch = body.index_for_search === true || body.index === true;
    if (indexForSearch && row) {
      try {
        const { indexMediaAssetForSearch } = await import('../core/moviemode-media-vectorize.js');
        const { transcriptFromAssetRow } = await import('../core/moviemode-whisper.js');
        const indexed = await indexMediaAssetForSearch(env, row, {
          caption: body.caption || body.description || null,
          transcript: body.transcript || transcriptFromAssetRow(row) || null,
          force: !!body.force_reindex,
        });
        return jsonResponse({
          ok: true,
          id: row.id,
          bucket,
          object_key,
          transcribe_queued: shouldTranscribe,
          index: indexed,
        });
      } catch (e) {
        return jsonResponse({
          ok: true,
          id: row.id,
          bucket,
          object_key,
          transcribe_queued: shouldTranscribe,
          index: { ok: false, error: String(e?.message || e).slice(0, 300) },
        });
      }
    }

    return jsonResponse({
      ok: true,
      id: row?.id || id,
      bucket,
      object_key,
      transcribe_queued: shouldTranscribe,
    });
  }

  if (path === '/api/moviemode/embed' && method === 'POST') {
    return handleVideoEmbedRequest(request, env, { workspaceId });
  }

  if (path === '/api/moviemode/search' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const query = String(body.query || body.q || '').trim();
    if (!query) return jsonResponse({ error: 'query required' }, 400);
    try {
      const { searchMovieModeMedia } = await import('../core/moviemode-media-vectorize.js');
      const out = await searchMovieModeMedia(env, {
        workspaceId,
        query,
        topK: body.top_k ?? body.limit ?? 12,
        projectId: body.project_id || null,
        mediaKind: body.media_kind || null,
      });
      return jsonResponse(out);
    } catch (e) {
      return jsonResponse({ ok: false, error: String(e?.message || e).slice(0, 400) }, 502);
    }
  }

  if (path === '/api/media/assets/index' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const assetId = String(body.asset_id || body.id || '').trim();
    if (!assetId) return jsonResponse({ error: 'asset_id required' }, 400);
    const row = await env.DB.prepare(
      `SELECT * FROM media_assets WHERE id = ? AND workspace_id = ? LIMIT 1`,
    )
      .bind(assetId, workspaceId)
      .first();
    if (!row) return jsonResponse({ error: 'Not found' }, 404);
    try {
      const { indexMediaAssetForSearch } = await import('../core/moviemode-media-vectorize.js');
      const { transcriptFromAssetRow } = await import('../core/moviemode-whisper.js');
      const indexed = await indexMediaAssetForSearch(env, row, {
        caption: body.caption || body.description || null,
        transcript: body.transcript || transcriptFromAssetRow(row) || null,
        force: body.force !== false,
      });
      return jsonResponse({ ok: true, asset_id: assetId, index: indexed });
    } catch (e) {
      return jsonResponse({ ok: false, error: String(e?.message || e).slice(0, 400) }, 502);
    }
  }

  if (path === '/api/moviemode/render-jobs' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const projectId = String(body.project_id || '').trim();
    if (!projectId) return jsonResponse({ error: 'project_id required' }, 400);
    const id = `mmrender_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    await env.DB.prepare(
      `INSERT INTO moviemode_render_jobs (id, tenant_id, workspace_id, project_id, timeline_id, renderer, status, input_json)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)`,
    )
      .bind(
        id,
        tenantId,
        workspaceId,
        projectId,
        body.timeline_id || null,
        body.renderer || 'remotion',
        JSON.stringify(body.input || {}),
      )
      .run();
    return jsonResponse({ ok: true, id, status: 'queued' });
  }

  const renderMatch = path.match(/^\/api\/moviemode\/render-jobs\/([^/]+)$/);
  if (renderMatch && method === 'PATCH') {
    const id = decodeURIComponent(renderMatch[1]);
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    await env.DB.prepare(
      `UPDATE moviemode_render_jobs SET
        status = COALESCE(?, status),
        progress_pct = COALESCE(?, progress_pct),
        output_json = COALESCE(?, output_json),
        error_message = COALESCE(?, error_message),
        completed_at = CASE WHEN ? IN ('complete','failed','cancelled') THEN datetime('now') ELSE completed_at END,
        updated_at = datetime('now')
       WHERE id = ? AND workspace_id = ?`,
    )
      .bind(
        body.status || null,
        body.progress_pct ?? null,
        body.output_json != null ? JSON.stringify(body.output_json) : null,
        body.error_message || null,
        body.status || null,
        id,
        workspaceId,
      )
      .run();
    return jsonResponse({ ok: true, id });
  }

  const timelineGetMatch = path.match(/^\/api\/moviemode\/timelines\/([^/]+)$/);
  if (timelineGetMatch && method === 'GET') {
    const id = decodeURIComponent(timelineGetMatch[1]);
    const row = await env.DB.prepare(
      `SELECT * FROM moviemode_timelines WHERE id = ? AND workspace_id = ? LIMIT 1`,
    )
      .bind(id, workspaceId)
      .first();
    if (!row) return jsonResponse({ error: 'Not found' }, 404);
    let timeline_json = {};
    try {
      timeline_json = JSON.parse(row.timeline_json || '{}');
    } catch {
      timeline_json = {};
    }
    return jsonResponse({ timeline: { ...row, timeline_json } });
  }

  if (timelineGetMatch && method === 'PUT') {
    const id = decodeURIComponent(timelineGetMatch[1]);
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const existing = await env.DB.prepare(
      `SELECT id FROM moviemode_timelines WHERE id = ? AND workspace_id = ? LIMIT 1`,
    )
      .bind(id, workspaceId)
      .first();
    if (!existing) return jsonResponse({ error: 'Not found' }, 404);
    const timelineJson =
      body.timeline_json != null
        ? JSON.stringify(body.timeline_json)
        : body.timeline != null
          ? JSON.stringify(body.timeline)
          : null;
    await env.DB.prepare(
      `UPDATE moviemode_timelines SET
         timeline_json = COALESCE(?, timeline_json),
         version = COALESCE(?, version),
         fps = COALESCE(?, fps),
         width = COALESCE(?, width),
         height = COALESCE(?, height),
         duration_frames = COALESCE(?, duration_frames),
         status = COALESCE(?, status),
         updated_at = datetime('now')
       WHERE id = ? AND workspace_id = ?`,
    )
      .bind(
        timelineJson,
        body.version ?? null,
        body.fps ?? null,
        body.width ?? null,
        body.height ?? null,
        body.duration_frames ?? null,
        body.status || null,
        id,
        workspaceId,
      )
      .run();
    return jsonResponse({ ok: true, id, autosaved: true });
  }

  if (path === '/api/moviemode/timelines' && method === 'GET') {
    const projectId = url.searchParams.get('project_id');
    const stmt = projectId
      ? env.DB.prepare(
          `SELECT * FROM moviemode_timelines WHERE workspace_id = ? AND project_id = ? ORDER BY updated_at DESC LIMIT 50`,
        ).bind(workspaceId, projectId)
      : env.DB.prepare(
          `SELECT * FROM moviemode_timelines WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 50`,
        ).bind(workspaceId);
    const { results } = await stmt.all();
    return jsonResponse({ timelines: results || [] });
  }

  if (path === '/api/moviemode/timelines' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const projectId = String(body.project_id || '').trim();
    if (!projectId) return jsonResponse({ error: 'project_id required' }, 400);
    const id = `mmtl_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const timelineJson = JSON.stringify(body.timeline_json || body.timeline || {});
    await env.DB.prepare(
      `INSERT INTO moviemode_timelines (id, tenant_id, workspace_id, project_id, version, renderer, fps, width, height, duration_frames, timeline_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        tenantId,
        workspaceId,
        projectId,
        body.version ?? 1,
        body.renderer || 'remotion',
        body.fps ?? 30,
        body.width ?? 1920,
        body.height ?? 1080,
        body.duration_frames ?? null,
        timelineJson,
      )
      .run();
    return jsonResponse({ ok: true, id });
  }

  // ─── Remotion export (PATCH 5) ─────────────────────────────────────────────
  if (path === '/api/moviemode/export' && method === 'POST') {
    return handleMoviemodeExport(request, env, { workspaceId, tenantId, userId });
  }

  const exportStatusMatch = path.match(/^\/api\/moviemode\/export-status\/([^/]+)$/);
  if (exportStatusMatch && method === 'GET') {
    return handleMoviemodeExportStatus(env, decodeURIComponent(exportStatusMatch[1]));
  }

  if (path === '/api/moviemode/ingest' && method === 'POST') {
    return handleMoviemodeIngest(request, env);
  }

  const sessionMatch = path.match(/^\/api\/moviemode\/sessions(?:\/([^/]+))?$/);
  if (sessionMatch && method === 'GET') {
    const sessionId = sessionMatch[1] ? decodeURIComponent(sessionMatch[1]) : null;
    return handleMoviemodeSessionGet(env, { workspaceId, tenantId, sessionId });
  }
  if (sessionMatch && method === 'PUT') {
    const sessionId = sessionMatch[1] ? decodeURIComponent(sessionMatch[1]) : null;
    return handleMoviemodeSessionPut(request, env, { workspaceId, tenantId, sessionId });
  }

  if (path === '/api/moviemode/assets/save' && method === 'POST') {
    return handleMoviemodeAssetSave(request, env, { workspaceId, authUser });
  }

  const veoJobMatch = path.match(/^\/api\/moviemode\/veo-jobs\/([^/]+)$/);
  if (veoJobMatch && method === 'GET') {
    return handleMoviemodeVeoJobGet(env, decodeURIComponent(veoJobMatch[1]), workspaceId);
  }

  if (path === '/api/moviemode/agent' && method === 'POST') {
    return handleMoviemodeAgent(request, env, { workspaceId, tenantId, userId });
  }

  return jsonResponse({ error: 'MovieMode route not matched' }, 404);
}

const JOB_KV_PREFIX = 'moviemode_job_';
const SESSION_KV_PREFIX = 'moviemode_session_';

function jobKvKey(jobId) {
  return `${JOB_KV_PREFIX}${jobId}`;
}

async function readJob(env, jobId) {
  const kv = resolveMoviemodeKv(env);
  if (!kv) return null;
  const raw = await kv.get(jobKvKey(jobId));
  return raw ? JSON.parse(raw) : null;
}

async function writeJob(env, jobId, row) {
  const kv = resolveMoviemodeKv(env);
  if (kv) {
    await kv.put(jobKvKey(jobId), JSON.stringify(row), { expirationTtl: 3600 });
  }
}

export async function handleMoviemodeExport(request, env, { workspaceId, tenantId, userId }) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const lane = parseMoviemodeExportExecLane(body);
  if (!lane.ok) {
    return jsonResponse(
      {
        error: lane.code,
        message:
          lane.code === 'exec_lane_required'
            ? 'Pick Local, VM, or Sandbox in the terminal dock before export'
            : `Invalid exec_lane: ${lane.raw || ''}`,
      },
      400,
    );
  }
  const session = body.session || {};
  const config = body.config || { codec: 'h264', quality: '720p', fps: 30 };
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const renderJobId = `mmrender_${jobId}`;
  const ext = config.codec === 'vp9' ? 'webm' : config.codec === 'gif' ? 'gif' : 'mp4';
  const outputFilename = `${jobId}.${ext}`;

  if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);

  const { ensureMoviemodeExportProject, ensureMoviemodeProject } = await import(
    '../core/moviemode-projects.js',
  );
  let exportProjectId = body.project_id ? String(body.project_id).trim() : '';
  if (exportProjectId) {
    await ensureMoviemodeProject(env, {
      tenantId,
      workspaceId,
      projectId: exportProjectId,
    });
  } else {
    exportProjectId = await ensureMoviemodeExportProject(env, { tenantId, workspaceId });
  }

  const inputJson = JSON.stringify({
    session,
    config,
    outputFilename,
    exec_lane: lane.lane,
    jobId,
  });
  try {
    await env.DB.prepare(
      `INSERT INTO moviemode_render_jobs (id, tenant_id, workspace_id, project_id, renderer, status, input_json, progress_pct)
       VALUES (?, ?, ?, ?, 'remotion', 'queued', ?, 0)`,
    )
      .bind(renderJobId, tenantId, workspaceId, exportProjectId, inputJson)
      .run();
  } catch (e) {
    return jsonResponse(
      {
        error: 'render_job_insert_failed',
        message: String(e?.message || e).slice(0, 400),
      },
      502,
    );
  }

  const job = {
    jobId,
    renderJobId,
    status: 'queued',
    progressPercent: 0,
    outputFilename,
    workspaceId,
    tenantId,
    userId,
    projectId: exportProjectId,
    startedAt: Date.now(),
    config,
    session,
    execLane: lane.lane,
    renderLane: lane.lane,
  };
  await writeJob(env, jobId, job);

  const runPromise = import('../../backend/agentsam/terminal/connections.js').then(({ getSelectedTerminalConnection }) => startRemotionRender(env, jobId, job, { getConnection: getSelectedTerminalConnection })).catch(async (err) => {
    await writeJob(env, jobId, {
      ...job,
      status: 'error',
      progressPercent: 0,
      errorMessage: String(err?.message || err).slice(0, 500),
      errorCode: 'export_throw',
    });
  });
  if (env._ctx?.waitUntil) env._ctx.waitUntil(runPromise);
  else void runPromise;

  return jsonResponse({
    jobId,
    outputFilename,
    status: 'queued',
    exec_lane: lane.lane,
    render_job_id: renderJobId,
  });
}

export async function handleMoviemodeExportStatus(env, jobId) {
  const job = await readJob(env, jobId);
  if (!job) return jsonResponse({ status: 'not_found', jobId }, 404);
  return jsonResponse({
    jobId,
    status: job.status,
    progressPercent: job.progressPercent ?? 0,
    r2Key: job.r2Key,
    errorMessage: job.errorMessage,
    errorCode: job.errorCode ?? null,
    expectedPath: job.expectedPath ?? null,
    workspaceRoot: job.workspaceRoot ?? null,
    installCommand: job.installCommand ?? null,
    uiHint: job.uiHint ?? null,
    renderLane: job.renderLane ?? job.execLane ?? null,
    exec_lane: job.execLane ?? job.renderLane ?? null,
  });
}

export async function handleMoviemodeIngest(request, env) {
  const bridgeKey = request.headers.get('X-Bridge-Key');
  if (!env.AGENTSAM_BRIDGE_KEY || bridgeKey !== env.AGENTSAM_BRIDGE_KEY) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }
  const jobId = request.headers.get('X-Job-Id') || '';
  const filename = request.headers.get('X-Filename') || `export_${Date.now()}.mp4`;
  const buffer = await request.arrayBuffer();
  if (!buffer?.byteLength) return jsonResponse({ error: 'empty body' }, 400);

  const kvJob = jobId ? (await readJob(env, jobId)) || {} : {};
  const workspaceId =
    request.headers.get('X-Workspace-Id') ||
    kvJob.workspaceId ||
    '';
  const tenantId =
    request.headers.get('X-Tenant-Id') ||
    kvJob.tenantId ||
    '';
  const userId = request.headers.get('X-User-Id') || kvJob.userId || '';

  if (!workspaceId || !tenantId) {
    return jsonResponse({ error: 'workspace_id and tenant_id required' }, 400);
  }

  const ext = filename.split('.').pop() || 'mp4';
  const mime = ext === 'webm' ? 'video/webm' : ext === 'gif' ? 'image/gif' : 'video/mp4';

  let finalized;
  try {
    const { finalizeMoviemodeOutput } = await import('../core/moviemode-persistence.js');
    finalized = await finalizeMoviemodeOutput(env, buffer, {
      jobId,
      filename,
      contentType: mime,
      workspaceId: String(workspaceId),
      tenantId: String(tenantId),
      userId: String(userId),
      projectId: kvJob.projectId || request.headers.get('X-Project-Id') || null,
      renderJobId: jobId ? `mmrender_${jobId}` : null,
      width: kvJob.config?.quality === '1080p' ? 1920 : kvJob.config?.quality === '480p' ? 854 : 1280,
      height: kvJob.config?.quality === '1080p' ? 1080 : kvJob.config?.quality === '480p' ? 480 : 720,
      fps: kvJob.config?.fps ?? 30,
      variantType: 'custom',
    });
  } catch (e) {
    return jsonResponse({ error: String(e?.message || e).slice(0, 400) }, 502);
  }

  if (jobId) {
    await writeJob(env, jobId, {
      ...kvJob,
      status: 'done',
      progressPercent: 100,
      r2Key: finalized.r2_key,
      artifactId: finalized.artifact_id,
      outputFilename: filename,
    });
  }

  return jsonResponse({
    ok: true,
    r2Key: finalized.r2_key,
    artifact_id: finalized.artifact_id,
    export_id: finalized.export_id,
  });
}

export async function handleMoviemodeSessionGet(env, { workspaceId, tenantId, sessionId }) {
  if (sessionId && env.DB) {
    const row = await env.DB.prepare(
      `SELECT * FROM moviemode_edit_sessions WHERE id = ? AND workspace_id = ? LIMIT 1`,
    )
      .bind(sessionId, workspaceId)
      .first();
    if (row) {
      let parsed = null;
      try {
        parsed = JSON.parse(row.clips_json || '[]');
      } catch {
        parsed = null;
      }
      if (parsed?.version === 1 && Array.isArray(parsed.tracks)) {
        return jsonResponse({
          session: { ...parsed, id: row.id, project_id: row.project_id || null },
          storage: 'd1_timeline',
        });
      }
      return jsonResponse({
        session: {
          id: row.id,
          clips: Array.isArray(parsed) ? parsed : [],
          overlays: JSON.parse(row.overlays_json || '[]'),
          export_config: JSON.parse(row.export_config || '{}'),
          project_id: row.project_id || null,
          status: row.status,
        },
        storage: 'd1_legacy',
      });
    }
  }

  const sessionKey = `${SESSION_KV_PREFIX}${workspaceId}`;
  const kv = resolveMoviemodeKv(env);
  if (kv) {
    const raw = await kv.get(sessionKey);
    if (raw) {
      const session = JSON.parse(raw);
      return jsonResponse({
        session,
        storage: session?.version === 1 ? 'kv_timeline' : 'kv',
      });
    }
  }

  return jsonResponse({
    session: { clips: [], overlays: [], fps: 30, width: 1280, height: 720 },
    storage: 'default',
  });
}

export async function handleMoviemodeSessionPut(request, env, { workspaceId, tenantId, sessionId }) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const session = body.session || body;
  const id = sessionId || body.id || `mms_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const clipsJson =
    session?.version === 1 && Array.isArray(session.tracks)
      ? JSON.stringify(session)
      : JSON.stringify(session.clips || []);
  const overlaysJson = JSON.stringify(session.overlays || []);
  const exportConfig = JSON.stringify(session.export_config || session.exportConfig || {});

  if (kv) {
    const sessionKey = `${SESSION_KV_PREFIX}${workspaceId}`;
    await kv.put(sessionKey, JSON.stringify(session), { expirationTtl: 86400 });
  }

  if (env.DB) {
    await env.DB.prepare(
      `INSERT INTO moviemode_edit_sessions (id, workspace_id, tenant_id, session_name, clips_json, overlays_json, export_config, project_id, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', unixepoch())
       ON CONFLICT(id) DO UPDATE SET
         clips_json = excluded.clips_json,
         overlays_json = excluded.overlays_json,
         export_config = excluded.export_config,
         project_id = COALESCE(excluded.project_id, project_id),
         updated_at = unixepoch()`,
    )
      .bind(
        id,
        workspaceId,
        tenantId,
        String(body.session_name || body.name || 'Untitled Edit').slice(0, 200),
        clipsJson,
        overlaysJson,
        exportConfig,
        body.project_id || session.project_id || null,
      )
      .run()
      .catch((e) => console.warn('[moviemode] session autosave', e?.message));
  }

  return jsonResponse({ ok: true, id, autosaved: true });
}

export async function handleMoviemodeAssetSave(request, env, { workspaceId, authUser }) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const destination = String(body.destination || '').trim().toLowerCase();
  if (!['byok_r2', 'google_drive', 'local'].includes(destination)) {
    return jsonResponse({ error: 'destination must be byok_r2, google_drive, or local' }, 400);
  }

  let bytes;
  let contentType = String(body.content_type || 'video/mp4');
  let filename = String(body.filename || `moviemode-${Date.now()}.mp4`).trim();

  if (body.r2_key || body.object_key) {
    const bucketName = String(body.bucket || 'artifacts').trim();
    const key = String(body.r2_key || body.object_key).trim();
    const { resolveArtifactR2Binding } = await import('../core/artifact-key.js');
    const { getR2Binding } = await import('./r2-api.js');
    const binding =
      resolveArtifactR2Binding(env, bucketName) || getR2Binding(env, bucketName);
    if (!binding?.get) return jsonResponse({ error: 'source bucket not available' }, 503);
    const obj = await binding.get(key);
    if (!obj) return jsonResponse({ error: 'source object not found' }, 404);
    bytes = new Uint8Array(await obj.arrayBuffer());
    contentType = obj.httpMetadata?.contentType || contentType;
    if (!body.filename) filename = key.split('/').pop() || filename;
  } else if (body.video_base64) {
    bytes = Uint8Array.from(atob(String(body.video_base64)), (c) => c.charCodeAt(0));
  } else {
    return jsonResponse({ error: 'r2_key or video_base64 required' }, 400);
  }

  if (destination === 'local') {
    let video_base64 = body.video_base64;
    if (!video_base64 && bytes) {
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      video_base64 = btoa(binary);
    }
    return jsonResponse({
      ok: true,
      destination: 'local',
      content_type: contentType,
      filename,
      video_base64,
      byte_length: bytes.byteLength,
    });
  }

  const { saveBrowserCaptureForUser } = await import('../../backend/browser/capture/storage.js');
  let image_base64 = body.video_base64;
  if (!image_base64 && bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    image_base64 = btoa(binary);
  }
  const out = await saveBrowserCaptureForUser(env, authUser, {
    destination,
    image_base64,
    content_type: contentType,
    filename,
    dest_bucket: body.dest_bucket,
    dest_key: body.dest_key,
  });
  return jsonResponse(out, out.ok ? 200 : 400);
}

const VEO_JOB_KV_PREFIX = 'veo_job_';

export async function handleMoviemodeVeoJobGet(env, jobId, workspaceId) {
  const id = String(jobId || '').trim();
  if (!id) return jsonResponse({ error: 'job_id required' }, 400);

  // On-demand LRO check so chat/status clients do not wait for the 30m cron.
  try {
    const { pollVeoJobById } = await import('../core/moviemode-veo-poll.js');
    const polled = await pollVeoJobById(env, id);
    if (polled?.job) {
      const job = polled.job;
      if (workspaceId && job.workspace_id && job.workspace_id !== workspaceId) {
        return jsonResponse({ error: 'Forbidden' }, 403);
      }
      return jsonResponse({
        ok: true,
        job,
        polled: !!polled.polled,
        error: polled.error || undefined,
      });
    }
  } catch (e) {
    console.warn('[veo-job-get] poll', e?.message ?? e);
  }

  const kv = resolveMoviemodeKv(env);
  if (!kv) return jsonResponse({ error: 'KV not configured' }, 503);
  const raw = await kv.get(`${VEO_JOB_KV_PREFIX}${id}`);
  if (!raw) return jsonResponse({ error: 'Not found' }, 404);
  const job = JSON.parse(raw);
  if (workspaceId && job.workspace_id && job.workspace_id !== workspaceId) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }
  return jsonResponse({ ok: true, job, polled: false });
}

export async function handleMoviemodeAgent(request, env, { workspaceId, tenantId, userId }) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const sessionKey = `${SESSION_KV_PREFIX}${body.workspace_id || workspaceId || 'default'}`;
  const defaultSession = { clips: [], overlays: [], fps: 30, width: 1280, height: 720 };

  const getSession = async () => {
    const kv = resolveMoviemodeKv(env);
    if (!kv) return defaultSession;
    const raw = await kv.get(sessionKey);
    return raw ? JSON.parse(raw) : defaultSession;
  };
  const saveSession = async (s) => {
    const kv = resolveMoviemodeKv(env);
    if (kv) await kv.put(sessionKey, JSON.stringify(s), { expirationTtl: 86400 });
  };

  const action = String(body.action || '').trim();

  if (action === 'get_timeline') {
    return jsonResponse(await getSession());
  }

  if (action === 'describe_timeline') {
    const s = await getSession();
    const clips = Array.isArray(s.clips) ? s.clips : [];
    const overlays = Array.isArray(s.overlays) ? s.overlays : [];
    const videoMs = clips
      .filter((c) => c.trackType === 'video')
      .reduce((acc, c) => acc + (c.durationMs - c.trimInMs - c.trimOutMs), 0);
    const description = [
      `${clips.filter((c) => c.trackType === 'video').length} video clip(s)`,
      `${clips.filter((c) => c.trackType === 'audio').length} audio clip(s)`,
      `${overlays.length} text overlay(s)`,
      `total ~${(videoMs / 1000).toFixed(1)}s`,
    ].join(' | ');
    return jsonResponse({ description, session: s });
  }

  if (action === 'trim_clip') {
    const s = await getSession();
    s.clips = (s.clips || []).map((c) =>
      c.id !== body.clip_id
        ? c
        : {
            ...c,
            trimInMs: body.trim_in_ms ?? c.trimInMs,
            trimOutMs: body.trim_out_ms ?? c.trimOutMs,
          },
    );
    await saveSession(s);
    return jsonResponse({ updated: true });
  }

  if (action === 'add_text') {
    const s = await getSession();
    s.overlays = s.overlays || [];
    s.overlays.push({
      id: `txt_${Date.now()}`,
      text: body.text ?? 'Text',
      startMs: body.start_ms ?? 0,
      durationMs: body.duration_ms ?? 3000,
      x: body.x ?? 50,
      y: body.y ?? 80,
      fontSize: body.font_size ?? 36,
      color: body.color ?? '#ffffff',
      fontWeight: body.font_weight ?? 'bold',
      background: body.background ?? 'rgba(0,0,0,0.55)',
      align: body.align ?? 'center',
      animation: body.animation ?? 'fade-in',
    });
    await saveSession(s);
    return jsonResponse({ added: true });
  }

  if (action === 'delete_clip') {
    const s = await getSession();
    s.clips = (s.clips || []).filter((c) => c.id !== body.clip_id);
    await saveSession(s);
    return jsonResponse({ deleted: true });
  }

  if (action === 'save_session') {
    await saveSession(body.session || defaultSession);
    return jsonResponse({ saved: true });
  }

  if (action === 'export') {
    const s = await getSession();
    const exportReq = new Request('https://inneranimalmedia.com/api/moviemode/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: s,
        config: {
          codec: body.codec || 'h264',
          quality: body.quality || '720p',
          fps: body.fps || 30,
        },
        project_id: body.project_id,
        exec_lane: body.exec_lane,
      }),
    });
    return handleMoviemodeExport(exportReq, env, {
      workspaceId: body.workspace_id || workspaceId,
      tenantId: body.tenant_id || tenantId,
      userId,
    });
  }

  return jsonResponse({ error: `Unknown action: ${action}` }, 400);
}


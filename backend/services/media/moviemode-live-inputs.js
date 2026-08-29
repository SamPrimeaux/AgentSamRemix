/**
 * MovieMode Live Input lane — D1 rows + Cloudflare Stream Live Inputs API.
 */

import { resolveCfStreamContext } from './cloudflare-stream.js';

async function streamApiFetch(env, path, init = {}, auth = {}) {
  const streamContext = await resolveCfStreamContext(env, {
    userId: auth?.userId ?? auth?.user_id,
    workspaceId: auth?.workspaceId ?? auth?.workspace_id,
    requireWrite: ['POST', 'PUT', 'DELETE'].includes(String(init.method || '').toUpperCase()),
  });
  if (!streamContext.ok) {
    throw new Error(streamContext.message || streamContext.error || 'cloudflare_stream_not_connected');
  }
  const { token, accountId } = streamContext;
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success) {
    const msg = data.errors?.[0]?.message || `Stream API HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data.result;
}

export function mapLiveInputStatusFromEvent(eventType) {
  const e = String(eventType || '').trim();
  if (e === 'live_input.connected') return 'connected';
  if (e === 'live_input.disconnected') return 'awaiting_vod';
  if (e === 'live_input.errored') return 'error';
  return null;
}

/**
 * @param {unknown} row
 */
export function serializeLiveInputRow(row) {
  if (!row) return null;
  let meta = {};
  try {
    meta = JSON.parse(row.metadata_json || '{}');
  } catch {
    meta = {};
  }
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    project_id: row.project_id,
    stream_live_input_uid: row.stream_live_input_uid,
    name: row.name,
    status: row.status,
    recording_mode: row.recording_mode,
    rtmps_url: row.rtmps_url,
    webrtc_publish_url: row.webrtc_publish_url,
    hls_playback_url: row.hls_playback_url,
    last_vod_uid: row.last_vod_uid,
    last_event_type: row.last_event_type,
    last_event_at: row.last_event_at,
    last_error_code: row.last_error_code,
    last_error_message: row.last_error_message,
    metadata: meta,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * @param {any} env
 * @param {string} workspaceId
 * @param {{ project_id?: string | null, limit?: number }} [opts]
 */
export async function listMoviemodeLiveInputs(env, workspaceId, opts = {}) {
  const limit = Math.min(Number(opts.limit) > 0 ? Number(opts.limit) : 50, 100);
  let sql = `SELECT * FROM moviemode_live_inputs WHERE workspace_id = ? AND status != 'archived'`;
  const binds = [workspaceId];
  if (opts.project_id) {
    sql += ` AND project_id = ?`;
    binds.push(String(opts.project_id));
  }
  sql += ` ORDER BY updated_at DESC LIMIT ?`;
  binds.push(limit);
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return (results || []).map(serializeLiveInputRow);
}

/**
 * @param {any} env
 * @param {{ workspaceId: string, tenantId: string, userId?: string }} auth
 * @param {{ name: string, project_id?: string | null, recording_mode?: string }} opts
 */
export async function createMoviemodeLiveInput(env, auth, opts) {
  const workspaceId = String(auth.workspaceId || '').trim();
  const tenantId = String(auth.tenantId || '').trim();
  const name = String(opts.name || '').trim();
  if (!name) throw new Error('name required');

  const recordingMode = String(opts.recording_mode || 'automatic').trim() || 'automatic';
  const projectId = opts.project_id ? String(opts.project_id).trim() : null;

  const cf = await streamApiFetch(env, '/stream/live_inputs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      meta: {
        name,
        iam_workspace_id: workspaceId,
        iam_project_id: projectId,
      },
      recording: {
        mode: recordingMode === 'off' ? 'off' : 'automatic',
        hideLiveViewerCount: false,
        requireSignedURLs: false,
        timeoutSeconds: 0,
      },
      enabled: true,
    }),
  }, auth);

  const uid = String(cf?.uid || '').trim();
  if (!uid) throw new Error('Stream live input uid missing');

  const id = `mmlive_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const rtmpsUrl = cf?.rtmps?.url ? String(cf.rtmps.url) : null;
  const webrtcUrl = cf?.webRTC?.url ? String(cf.webRTC.url) : null;
  const hls =
    cf?.playback?.hls ||
    (cf?.uid && cf?.customerSubdomain
      ? `https://${cf.customerSubdomain}/${uid}/manifest/video.m3u8`
      : null);

  const metadata = {
    stream_key_present: Boolean(cf?.rtmps?.streamKey),
    created_by_user_id: auth.userId || null,
    cf_created: cf?.created || null,
  };

  await env.DB.prepare(
    `INSERT INTO moviemode_live_inputs (
       id, tenant_id, workspace_id, project_id, stream_live_input_uid, name, status,
       recording_mode, rtmps_url, webrtc_publish_url, hls_playback_url, metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?, 'idle', ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      tenantId,
      workspaceId,
      projectId,
      uid,
      name,
      recordingMode,
      rtmpsUrl,
      webrtcUrl,
      hls,
      JSON.stringify(metadata),
    )
    .run();

  const row = await env.DB.prepare(`SELECT * FROM moviemode_live_inputs WHERE id = ? LIMIT 1`)
    .bind(id)
    .first();

  return {
    live_input: serializeLiveInputRow(row),
    credentials: {
      stream_live_input_uid: uid,
      rtmps: cf?.rtmps || null,
      webRTC: cf?.webRTC || null,
      srt: cf?.srt || null,
    },
  };
}

/**
 * @param {any} env
 * @param {string} liveInputUid
 */
export async function listStreamLiveInputVideos(env, liveInputUid, auth = {}) {
  const uid = String(liveInputUid || '').trim();
  if (!uid) return [];
  const result = await streamApiFetch(env, `/stream/live_inputs/${uid}/videos`, {}, auth);
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.videos)) return result.videos;
  return [];
}

/**
 * Apply Stream Live notification payload to moviemode_live_inputs.
 * @param {any} env
 * @param {Record<string, unknown>} payload
 */
export async function applyStreamLiveWebhookToMoviemode(env, payload) {
  const data = /** @type {any} */ (payload?.data || payload);
  const inputId = String(data?.input_id || data?.inputId || '').trim();
  const eventType = String(data?.event_type || data?.eventType || '').trim();
  if (!inputId || !eventType) {
    return { ok: false, reason: 'missing_input_or_event' };
  }

  const status = mapLiveInputStatusFromEvent(eventType);
  const updatedAt = String(data?.updated_at || new Date().toISOString());
  let errorCode = null;
  let errorMessage = null;
  if (eventType === 'live_input.errored') {
    const err = data?.live_input_errored?.error || data?.error || {};
    errorCode = err?.code ? String(err.code) : null;
    errorMessage = err?.message ? String(err.message) : null;
  }

  const row = await env.DB.prepare(
    `SELECT * FROM moviemode_live_inputs WHERE stream_live_input_uid = ? LIMIT 1`,
  )
    .bind(inputId)
    .first();

  if (!row) {
    return { ok: true, matched: false, input_id: inputId, event_type: eventType };
  }

  await env.DB.prepare(
    `UPDATE moviemode_live_inputs SET
       status = COALESCE(?, status),
       last_event_type = ?,
       last_event_at = ?,
       last_error_code = COALESCE(?, last_error_code),
       last_error_message = COALESCE(?, last_error_message),
       updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(status, eventType, updatedAt, errorCode, errorMessage, row.id)
    .run();

  return {
    ok: true,
    matched: true,
    live_input_id: row.id,
    workspace_id: row.workspace_id,
    input_id: inputId,
    event_type: eventType,
    status,
  };
}

/**
 * When a VOD finishes encoding, link to live input + optional R2 import.
 * @param {any} env
 * @param {any} [ctx]
 * @param {Record<string, unknown>} payload
 */
export async function applyStreamVodWebhookToMoviemode(env, ctx, payload) {
  const videoUid = String(payload?.uid || '').trim();
  if (!videoUid) return { ok: false, reason: 'missing_video_uid' };

  const state = String(payload?.status?.state || '').trim();
  const ready = payload?.readyToStream === true || state === 'ready';
  const errored = state === 'error';

  const eventKind = errored ? 'video.error' : ready ? 'video.ready' : 'video.processing';
  if (!ready && !errored) {
    return { ok: true, video_uid: videoUid, event_kind: eventKind, action: 'ignored' };
  }

  const { results: candidates } = await env.DB.prepare(
    `SELECT * FROM moviemode_live_inputs
     WHERE status IN ('awaiting_vod', 'disconnected', 'connected', 'live')
     ORDER BY updated_at DESC LIMIT 25`,
  ).all();

  let matched = null;
  for (const row of candidates || []) {
    try {
      const videos = await listStreamLiveInputVideos(env, row.stream_live_input_uid);
      if (videos.some((v) => String(v?.uid || '') === videoUid)) {
        matched = row;
        break;
      }
    } catch {
      /* try next */
    }
  }

  if (!matched) {
    return { ok: true, video_uid: videoUid, event_kind: eventKind, matched: false };
  }

  await env.DB.prepare(
    `UPDATE moviemode_live_inputs SET
       last_vod_uid = ?,
       status = ?,
       last_event_type = ?,
       last_event_at = datetime('now'),
       updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(videoUid, errored ? 'error' : 'idle', eventKind, matched.id)
    .run();

  if (ready && ctx?.waitUntil) {
    ctx.waitUntil(
      importLiveRecordingVod(env, matched, videoUid, payload).catch((e) => {
        console.warn('[stream-vod] auto-import', e?.message ?? e);
      }),
    );
  }

  return {
    ok: true,
    matched: true,
    live_input_id: matched.id,
    workspace_id: matched.workspace_id,
    video_uid: videoUid,
    event_kind: eventKind,
    auto_import_scheduled: ready && Boolean(ctx?.waitUntil),
  };
}

/**
 * @param {any} env
 * @param {any} row
 * @param {string} videoUid
 * @param {Record<string, unknown>} payload
 */
async function importLiveRecordingVod(env, row, videoUid, payload) {
  const workspaceId = String(row.workspace_id || '').trim();
  const tenantId = String(row.tenant_id || '').trim();
  if (!workspaceId || !tenantId) return;

  const filename =
    payload?.meta?.filename ||
    payload?.meta?.name ||
    `live-${row.stream_live_input_uid}-${videoUid}.mp4`;
  const projectSlug = row.project_id ? String(row.project_id) : 'live';
  const objectKey = `moviemode/${workspaceId}/${projectSlug}/source/live/${row.stream_live_input_uid}/${filename}`;

  const { importStreamVideoToR2 } = await import('./cloudflare-stream-api.js');
  const copied = await importStreamVideoToR2(env, { uid: videoUid, objectKey });

  const assetId = `asset_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const durationMs =
    payload?.duration != null ? Math.round(Number(payload.duration) * 1000) : null;

  const meta = {
    stream_uid: videoUid,
    live_input_uid: row.stream_live_input_uid,
    imported_from: 'stream_live_recording',
    moviemode_live_input_id: row.id,
  };

  await env.DB.prepare(
    `INSERT INTO media_assets (
       id, tenant_id, workspace_id, project_id, source_kind, source_uri,
       bucket, object_key, filename, content_type, media_kind, size_bytes,
       duration_ms, status, metadata_json
     ) VALUES (?, ?, ?, ?, 'stream_live', ?, ?, ?, ?, ?, 'video', ?, ?, 'uploaded', ?)
     ON CONFLICT(workspace_id, bucket, object_key) DO UPDATE SET
       duration_ms = excluded.duration_ms,
       status = 'uploaded',
       metadata_json = excluded.metadata_json,
       updated_at = datetime('now')`,
  )
    .bind(
      assetId,
      tenantId,
      workspaceId,
      row.project_id || null,
      videoUid,
      copied.bucket,
      copied.object_key,
      String(filename),
      copied.content_type,
      copied.size_bytes,
      durationMs,
      JSON.stringify(meta),
    )
    .run();

  try {
    const asset = await env.DB.prepare(
      `SELECT * FROM media_assets WHERE id = ? AND workspace_id = ? LIMIT 1`,
    )
      .bind(assetId, workspaceId)
      .first();
    if (asset) {
      const { transcribeAndReindexMediaAsset } = await import('./moviemode-whisper.js');
      await transcribeAndReindexMediaAsset(env, asset);
    }
  } catch {
    /* optional */
  }
}

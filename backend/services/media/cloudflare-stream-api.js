/**
 * Cloudflare Stream helpers — all calls take a resolved stream context
 * ({ token, accountId }) from resolveCfStreamContext. No helper reads Worker secrets.
 */

function assertStreamCtx(streamCtx) {
  const token = String(streamCtx?.token || '').trim();
  const accountId = String(streamCtx?.accountId || streamCtx?.account_id || '').trim();
  if (!token || !accountId) {
    throw new Error('stream context required (token + accountId)');
  }
  return { token, accountId };
}

/**
 * Low-level Stream REST call using an already-resolved account context.
 * @param {{ token: string, accountId: string }} streamCtx
 * @param {string} path — path under /accounts/{accountId}, e.g. `/stream`
 * @param {RequestInit} [init]
 */
export async function streamApiFetch(streamCtx, path, init = {}) {
  const { token, accountId } = assertStreamCtx(streamCtx);
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
    const err = new Error(msg);
    err.status = res.status;
    err.cfErrors = data.errors || [];
    throw err;
  }
  return data.result;
}

export async function listStreamVideos(streamCtx, { limit = 100 } = {}) {
  const { accountId } = assertStreamCtx(streamCtx);
  const result = await streamApiFetch(
    streamCtx,
    `/stream?limit=${Math.min(limit, 100)}`,
  );
  const videos = Array.isArray(result) ? result : result?.videos || [];
  return {
    videos,
    total: result?.total || videos.length,
    accountId,
    customerSubdomain: videos[0]?.playback?.hls
      ? (() => {
          try {
            return new URL(videos[0].playback.hls).host;
          } catch {
            return null;
          }
        })()
      : null,
  };
}

export async function resolveStreamDownloadUrl(streamCtx, uid, { maxWaitMs = 45_000 } = {}) {
  const id = String(uid || '').trim();
  if (!id) throw new Error('stream uid required');

  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    let downloads = await streamApiFetch(streamCtx, `/stream/${id}/downloads`);
    const def = downloads?.default;
    if (def?.status === 'ready' && def.url) return def.url;
    if (!def || def.status === 'error') {
      await streamApiFetch(streamCtx, `/stream/${id}/downloads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    }
    await new Promise((r) => setTimeout(r, 2000));
    downloads = await streamApiFetch(streamCtx, `/stream/${id}/downloads`);
    if (downloads?.default?.status === 'ready' && downloads.default.url) {
      return downloads.default.url;
    }
  }
  throw new Error('Stream download not ready in time');
}

/**
 * Copy Stream VOD bytes into ASSETS and return { bucket, object_key, size_bytes }.
 */
export async function importStreamVideoToR2(env, streamCtx, { uid, objectKey, bucketBinding = 'ASSETS' }) {
  const downloadUrl = await resolveStreamDownloadUrl(streamCtx, uid);
  const videoRes = await fetch(downloadUrl);
  if (!videoRes.ok) {
    throw new Error(`Stream download fetch failed HTTP ${videoRes.status}`);
  }
  const bytes = await videoRes.arrayBuffer();
  const bucket = env[bucketBinding];
  if (!bucket?.put) throw new Error(`${bucketBinding} R2 binding missing`);

  const key = String(objectKey || '').trim();
  if (!key) throw new Error('object_key required');

  const contentType = videoRes.headers.get('content-type') || 'video/mp4';
  await bucket.put(key, bytes, {
    httpMetadata: { contentType },
  });

  return {
    bucket: 'inneranimalmedia',
    object_key: key,
    size_bytes: bytes.byteLength,
    content_type: contentType,
  };
}

export async function getStreamWebhook(streamCtx) {
  return streamApiFetch(streamCtx, '/stream/webhook', { method: 'GET' });
}

export async function putStreamWebhook(streamCtx, notificationUrl) {
  const url = String(notificationUrl || '').trim();
  if (!url) throw new Error('notificationUrl required');
  return streamApiFetch(streamCtx, '/stream/webhook', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notificationUrl: url }),
  });
}

export async function createLiveInput(streamCtx, opts = {}) {
  const name = String(opts.name || 'MovieMode Live').trim();
  const recordingMode = String(opts.recording_mode || 'automatic').trim();
  const meta = opts.meta && typeof opts.meta === 'object' ? opts.meta : { name };
  return streamApiFetch(streamCtx, '/stream/live_inputs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      meta,
      recording: {
        mode: recordingMode === 'off' ? 'off' : 'automatic',
        hideLiveViewerCount: false,
        requireSignedURLs: false,
        timeoutSeconds: 0,
      },
      enabled: opts.enabled !== false,
    }),
  });
}

export async function listLiveInputs(streamCtx, { limit = 50 } = {}) {
  const result = await streamApiFetch(
    streamCtx,
    `/stream/live_inputs?limit=${Math.min(Number(limit) || 50, 100)}`,
  );
  if (Array.isArray(result)) return result;
  return result?.liveInputs || [];
}

export async function getLiveInput(streamCtx, uid) {
  const id = String(uid || '').trim();
  if (!id) throw new Error('live input uid required');
  return streamApiFetch(streamCtx, `/stream/live_inputs/${id}`);
}

export async function deleteLiveInput(streamCtx, uid) {
  const id = String(uid || '').trim();
  if (!id) throw new Error('live input uid required');
  return streamApiFetch(streamCtx, `/stream/live_inputs/${id}`, { method: 'DELETE' });
}

export async function getStreamVideoDetail(streamCtx, uid) {
  const id = String(uid || '').trim();
  if (!id) throw new Error('uid required');
  return streamApiFetch(streamCtx, `/stream/${id}`);
}

export async function updateStreamVideoDetail(streamCtx, uid, patch = {}) {
  const id = String(uid || '').trim();
  if (!id) throw new Error('uid required');
  const body = {};
  if (patch.meta && typeof patch.meta === 'object') body.meta = patch.meta;
  if (patch.requireSignedURLs !== undefined) body.requireSignedURLs = !!patch.requireSignedURLs;
  if (Array.isArray(patch.allowedOrigins)) body.allowedOrigins = patch.allowedOrigins;
  if (patch.thumbnailTimestampPct !== undefined) {
    body.thumbnailTimestampPct = Number(patch.thumbnailTimestampPct) || 0;
  }
  return streamApiFetch(streamCtx, `/stream/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function deleteStreamVideo(streamCtx, uid) {
  const id = String(uid || '').trim();
  if (!id) throw new Error('uid required');
  await streamApiFetch(streamCtx, `/stream/${id}`, { method: 'DELETE' });
  return { deleted: true };
}

export async function getStreamDownloads(streamCtx, uid) {
  const id = String(uid || '').trim();
  if (!id) throw new Error('uid required');
  return streamApiFetch(streamCtx, `/stream/${id}/downloads`);
}

export async function enableStreamDownloads(streamCtx, uid) {
  const id = String(uid || '').trim();
  if (!id) throw new Error('uid required');
  return streamApiFetch(streamCtx, `/stream/${id}/downloads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export async function deleteStreamDownloads(streamCtx, uid) {
  const id = String(uid || '').trim();
  if (!id) throw new Error('uid required');
  await streamApiFetch(streamCtx, `/stream/${id}/downloads`, { method: 'DELETE' });
  return { deleted: true };
}

export async function listStreamCaptions(streamCtx, uid) {
  const id = String(uid || '').trim();
  if (!id) throw new Error('uid required');
  const result = await streamApiFetch(streamCtx, `/stream/${id}/captions`);
  return Array.isArray(result) ? result : result?.captions || [];
}

export async function putStreamCaption(streamCtx, uid, language, vttText) {
  const id = String(uid || '').trim();
  const lang = String(language || '').trim();
  if (!id || !lang) throw new Error('uid and language required');
  const { token, accountId } = assertStreamCtx(streamCtx);
  const form = new FormData();
  form.append('file', new Blob([String(vttText || '')], { type: 'text/vtt' }), `${lang}.vtt`);
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${id}/captions/${lang}`,
    { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: form },
  );
  const data = await res.json().catch(() => ({}));
  if (!data.success) {
    const msg = data.errors?.[0]?.message || `Stream caption upload HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data.result;
}

export async function deleteStreamCaption(streamCtx, uid, language) {
  const id = String(uid || '').trim();
  const lang = String(language || '').trim();
  if (!id || !lang) throw new Error('uid and language required');
  await streamApiFetch(streamCtx, `/stream/${id}/captions/${lang}`, { method: 'DELETE' });
  return { deleted: true };
}

export async function copyStreamVideoFromUrl(streamCtx, { url, meta, requireSignedURLs } = {}) {
  const src = String(url || '').trim();
  if (!src) throw new Error('url required');
  const body = { url: src };
  if (meta && typeof meta === 'object') body.meta = meta;
  if (requireSignedURLs !== undefined) body.requireSignedURLs = !!requireSignedURLs;
  return streamApiFetch(streamCtx, `/stream/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function createStreamDirectUpload(
  streamCtx,
  { maxDurationSeconds = 3600, meta, requireSignedURLs } = {},
) {
  const body = { maxDurationSeconds: Number(maxDurationSeconds) || 3600 };
  if (meta && typeof meta === 'object') body.meta = meta;
  if (requireSignedURLs !== undefined) body.requireSignedURLs = !!requireSignedURLs;
  return streamApiFetch(streamCtx, `/stream/direct_upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Mint a short-lived signed playback token for requireSignedURLs videos.
 * Never returns the OAuth/API token — only the Stream playback JWT.
 * @see https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/
 */
export async function createStreamPlaybackToken(streamCtx, uid, { expiresInSeconds = 3600 } = {}) {
  const id = String(uid || '').trim();
  if (!id) throw new Error('uid required');
  const exp = Math.floor(Date.now() / 1000) + Math.max(60, Math.min(86400, Number(expiresInSeconds) || 3600));
  const result = await streamApiFetch(streamCtx, `/stream/${id}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exp }),
  });
  const token = String(result?.token || result || '').trim();
  if (!token) throw new Error('Stream token mint returned empty token');
  return { token, expires_at: exp };
}

/** CF Stream watch/embed/manifest URLs — host MUST come from playback HLS, never accountId. */
export function resolveStreamCustomerHost(videoOrPlayback, accountId) {
  const playback =
    videoOrPlayback?.playback && typeof videoOrPlayback.playback === 'object'
      ? videoOrPlayback.playback
      : videoOrPlayback;
  const hls = playback?.hls || videoOrPlayback?.preview || '';
  if (hls && /^https?:\/\//.test(String(hls))) {
    try {
      return new URL(String(hls)).host;
    } catch {
      /* fall through */
    }
  }
  const preview = videoOrPlayback?.preview;
  if (preview && /^https?:\/\//.test(String(preview))) {
    try {
      return new URL(String(preview)).host;
    } catch {
      /* fall through */
    }
  }
  void accountId;
  return null;
}

/**
 * @param {string} uid
 * @param {{ customerSubdomain?: string|null, video?: object, accountId?: string }} [opts]
 */
export function buildStreamWatchUrls(uid, opts = {}) {
  const id = String(uid || '').trim();
  const host =
    String(opts.customerSubdomain || '').trim() ||
    resolveStreamCustomerHost(opts.video, opts.accountId) ||
    null;
  if (!id || !host) {
    return {
      customer_subdomain: host,
      watch_url: null,
      iframe_url: null,
      hls: null,
      dash: null,
      thumbnail: null,
      url_error: host
        ? null
        : 'customer_subdomain unresolved — wait for Stream playback.hls before embedding',
    };
  }
  return {
    customer_subdomain: host,
    watch_url: `https://${host}/${id}/watch`,
    iframe_url: `https://${host}/${id}/iframe`,
    hls: `https://${host}/${id}/manifest/video.m3u8`,
    dash: `https://${host}/${id}/manifest/video.mpd`,
    thumbnail: `https://${host}/${id}/thumbnails/thumbnail.jpg?time=0s&height=360`,
    url_error: null,
  };
}

export function mapStreamVideoRow(v, accountId) {
  const uid = String(v.uid || '');
  const host = resolveStreamCustomerHost(v, accountId);
  const urls = buildStreamWatchUrls(uid, { customerSubdomain: host, video: v, accountId });
  const hls = v.playback?.hls || urls.hls || '';
  return {
    uid,
    name: v.meta?.name || v.meta?.filename || uid,
    duration_sec: typeof v.duration === 'number' ? v.duration : null,
    size_bytes: typeof v.size === 'number' ? v.size : null,
    ready: !!v.readyToStream,
    require_signed_urls: !!v.requireSignedURLs,
    thumbnail: v.thumbnail || urls.thumbnail,
    hls: hls || null,
    dash: urls.dash,
    watch_url: urls.watch_url,
    iframe_url: urls.iframe_url,
    customer_subdomain: urls.customer_subdomain,
    created: v.created || null,
    status: v.status?.state || null,
    url_error: urls.url_error,
    cloudflare_account_id: accountId || null,
  };
}

/**
 * Upsert IAM metadata for a Stream asset keyed by cloudflare_account_id + stream_uid.
 * workspace_id is provenance only (created_from_workspace_id).
 */
export async function upsertStreamMediaAsset(env, {
  streamCtx,
  video,
  userId,
  workspaceId,
  tenantId,
  providerStatus,
} = {}) {
  if (!env?.DB) return null;
  const accountId = String(streamCtx?.accountId || '').trim();
  const uid = String(video?.uid || '').trim();
  if (!accountId || !uid) return null;

  const status =
    providerStatus ||
    (video?.readyToStream ? 'ready' : video?.status?.state) ||
    'registered';
  const objectKey = `stream/${accountId}/${uid}`;
  const bucket = 'cloudflare_stream';
  const filename = video?.meta?.name || video?.meta?.filename || uid;
  const contentType = 'video/mp4';
  const sizeBytes = typeof video?.size === 'number' ? video.size : null;
  const durationMs =
    typeof video?.duration === 'number' ? Math.round(video.duration * 1000) : null;
  const urls = buildStreamWatchUrls(uid, { video, accountId });
  const assetId = `asset_stream_${uid.slice(0, 16)}`;
  const ws = String(workspaceId || '').trim() || `cfacct_${accountId.slice(0, 12)}`;
  const tenant = String(tenantId || '').trim();
  if (!tenant) return null;
  const meta = {
    provider: 'cloudflare_stream',
    stream_uid: uid,
    cloudflare_account_id: accountId,
    stream_hls_url: urls.hls,
    stream_watch_url: urls.watch_url,
    stream_iframe_url: urls.iframe_url,
  };

  await env.DB.prepare(
    `INSERT INTO media_assets (
       id, tenant_id, workspace_id, source_kind, source_uri, bucket, object_key,
       filename, content_type, media_kind, size_bytes, duration_ms, status,
       stream_uid, cloudflare_account_id, provider_credential_source,
       created_by_user_id, created_from_workspace_id, provider_status, metadata_json
     ) VALUES (?, ?, ?, 'stream', ?, ?, ?, ?, ?, 'video', ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cloudflare_account_id, stream_uid) DO UPDATE SET
       filename = excluded.filename,
       size_bytes = COALESCE(excluded.size_bytes, media_assets.size_bytes),
       duration_ms = COALESCE(excluded.duration_ms, media_assets.duration_ms),
       provider_status = excluded.provider_status,
       provider_credential_source = excluded.provider_credential_source,
       created_from_workspace_id = COALESCE(excluded.created_from_workspace_id, media_assets.created_from_workspace_id),
       metadata_json = excluded.metadata_json,
       updated_at = datetime('now')`,
  )
    .bind(
      assetId,
      tenant,
      ws,
      `stream://${uid}`,
      bucket,
      objectKey,
      String(filename).slice(0, 500),
      contentType,
      sizeBytes,
      durationMs,
      uid,
      accountId,
      streamCtx?.source || 'oauth',
      userId || null,
      workspaceId || null,
      String(status).slice(0, 64),
      JSON.stringify(meta),
    )
    .run()
    .catch(async (e) => {
      // UNIQUE index may not exist yet — fall back to workspace/bucket/object_key conflict.
      console.warn('[stream] upsertStreamMediaAsset primary', e?.message ?? e);
      await env.DB.prepare(
        `INSERT INTO media_assets (
           id, tenant_id, workspace_id, source_kind, source_uri, bucket, object_key,
           filename, content_type, media_kind, size_bytes, duration_ms, status,
           stream_uid, cloudflare_account_id, provider_credential_source,
           created_by_user_id, created_from_workspace_id, provider_status, metadata_json
         ) VALUES (?, ?, ?, 'stream', ?, ?, ?, ?, ?, 'video', ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, bucket, object_key) DO UPDATE SET
           stream_uid = excluded.stream_uid,
           cloudflare_account_id = excluded.cloudflare_account_id,
           provider_status = excluded.provider_status,
           provider_credential_source = excluded.provider_credential_source,
           metadata_json = excluded.metadata_json,
           updated_at = datetime('now')`,
      )
        .bind(
          assetId,
          tenant,
          ws,
          `stream://${uid}`,
          bucket,
          objectKey,
          String(filename).slice(0, 500),
          contentType,
          sizeBytes,
          durationMs,
          uid,
          accountId,
          streamCtx?.source || 'oauth',
          userId || null,
          workspaceId || null,
          String(status).slice(0, 64),
          JSON.stringify(meta),
        )
        .run();
    });

  return { id: assetId, stream_uid: uid, cloudflare_account_id: accountId };
}

/**
 * Confirm UID belongs to the resolved Cloudflare account (live CF GET + optional D1 meta).
 */
export async function assertStreamUidInAccount(env, streamCtx, uid) {
  const id = String(uid || '').trim();
  const accountId = String(streamCtx?.accountId || '').trim();
  if (!id || !accountId) {
    const err = new Error('uid and account required');
    err.status = 400;
    throw err;
  }

  if (env?.DB) {
    const foreign = await env.DB.prepare(
      `SELECT cloudflare_account_id FROM media_assets
       WHERE stream_uid = ? AND cloudflare_account_id IS NOT NULL
         AND cloudflare_account_id != ?
       LIMIT 1`,
    )
      .bind(id, accountId)
      .first()
      .catch(() => null);
    if (foreign?.cloudflare_account_id) {
      const err = new Error('stream_uid_account_mismatch');
      err.status = 403;
      throw err;
    }
  }

  try {
    return await getStreamVideoDetail(streamCtx, id);
  } catch (e) {
    const status = Number(e?.status) || 404;
    const err = new Error(status === 404 ? 'stream_video_not_in_account' : String(e?.message || e));
    err.status = status === 401 || status === 403 ? status : 404;
    throw err;
  }
}

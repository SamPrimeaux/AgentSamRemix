/**
 * Cloudflare Stream video API — account-scoped BYOK via resolveCfStreamContext.
 * Ownership boundary: cloudflare_account_id + stream_uid (not IAM workspace).
 */

import { jsonResponse } from '../core/auth.js';
import {
  getResourceTags,
  setResourceTags,
  RESOURCE_TYPE_STREAM_VIDEO,
} from '../core/cf-resource-tags.js';
import {
  resolveCfStreamContext,
  streamContextErrorResponse,
} from '../../backend/services/media/cloudflare-stream.js';
import {
  getStreamVideoDetail,
  updateStreamVideoDetail,
  deleteStreamVideo,
  getStreamDownloads,
  enableStreamDownloads,
  deleteStreamDownloads,
  listStreamCaptions,
  putStreamCaption,
  deleteStreamCaption,
  copyStreamVideoFromUrl,
  createStreamDirectUpload,
  createStreamPlaybackToken,
  buildStreamWatchUrls,
  assertStreamUidInAccount,
  upsertStreamMediaAsset,
  listStreamVideos,
  mapStreamVideoRow,
} from '../../backend/services/media/cloudflare-stream-api.js';

const STREAM_TAG_OPTS = { resourceType: RESOURCE_TYPE_STREAM_VIDEO };

function parseLegacyTagList(raw) {
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function resourceTagsFromBody(body) {
  if (body?.resource_tags && typeof body.resource_tags === 'object' && !Array.isArray(body.resource_tags)) {
    return body.resource_tags;
  }
  if (body?.tags && typeof body.tags === 'object' && !Array.isArray(body.tags)) {
    return body.tags;
  }
  const list = parseLegacyTagList(body?.tags);
  if (!list.length) return {};
  const out = {};
  for (const t of list) out[t] = '';
  return out;
}

async function mapDetail(video, accountId, env, streamCtx) {
  const uid = String(video?.uid || '');
  const meta = video?.meta || {};
  const urls = buildStreamWatchUrls(uid, { video, accountId });
  let resource_tags = {};
  let resource_tags_error = null;
  if (env && uid && streamCtx) {
    const tagRes = await getResourceTags(env, uid, {
      ...STREAM_TAG_OPTS,
      accountId: streamCtx.accountId,
      token: streamCtx.token,
    }).catch((e) => ({
      ok: false,
      error: String(e?.message || e),
      tags: {},
    }));
    if (tagRes.ok) resource_tags = tagRes.tags || {};
    else resource_tags_error = tagRes.error || 'Resource Tagging unavailable';
  }
  const legacy = parseLegacyTagList(meta.iam_tags);
  return {
    uid,
    name: meta.name || meta.filename || uid,
    status: video?.status?.state || null,
    ready: !!video?.readyToStream,
    duration_sec: typeof video?.duration === 'number' ? video.duration : null,
    size_bytes: typeof video?.size === 'number' ? video.size : null,
    created: video?.created || null,
    modified: video?.modified || null,
    require_signed_urls: !!video?.requireSignedURLs,
    allowed_origins: Array.isArray(video?.allowedOrigins) ? video.allowedOrigins : [],
    thumbnail_timestamp_pct: video?.thumbnailTimestampPct ?? null,
    tags: Object.keys(resource_tags).length ? Object.keys(resource_tags) : legacy,
    resource_tags,
    resource_tags_error,
    public_details: meta.iam_public_details || {},
    embed: meta.iam_embed || {},
    meta,
    playback: video?.playback || {},
    account_id: accountId,
    cloudflare_account_id: accountId,
    credential_source: streamCtx?.source || null,
    ...urls,
  };
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function resolveStreamForRequest(env, scope, { requireWrite = false } = {}) {
  const userId = String(scope?.userId || '').trim();
  const workspaceId = String(scope?.workspaceId || '').trim();
  return resolveCfStreamContext(env, {
    userId,
    workspaceId,
    requireWrite,
  });
}

/**
 * GET /api/stream/capabilities — connection + account + scope state for Videos UI.
 */
export async function handleStreamCapabilities(env, scope = {}) {
  const streamCtx = await resolveStreamForRequest(env, scope, { requireWrite: false });
  let account_video_count = 0;
  if (streamCtx.ok && env?.DB) {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM media_assets
       WHERE cloudflare_account_id = ? AND stream_uid IS NOT NULL`,
    )
      .bind(streamCtx.accountId)
      .first()
      .catch(() => null);
    account_video_count = Number(row?.c) || 0;
  }

  if (!streamCtx.ok) {
    return jsonResponse({
      ok: true,
      connected: false,
      account_id: null,
      account_name: null,
      credential_source: null,
      can_read: false,
      can_write: false,
      reconnect_required: !!streamCtx.reconnectRequired || streamCtx.error === 'stream_scope_missing',
      account_selection_required: streamCtx.error === 'cloudflare_account_selection_required',
      accounts: streamCtx.accounts || [],
      error: streamCtx.error || null,
      message: streamCtx.message || null,
      account_video_count,
      // legacy alias — count is by cloudflare_account_id, not IAM workspace
      workspace_video_count: account_video_count,
      platform_owned: false,
    });
  }

  return jsonResponse({
    ok: true,
    connected: true,
    account_id: streamCtx.accountId,
    account_name: null,
    credential_source: streamCtx.source,
    can_read: !!streamCtx.capabilities?.read,
    can_write: !!streamCtx.capabilities?.write,
    reconnect_required: false,
    account_selection_required: false,
    accounts: [],
    account_video_count,
    workspace_video_count: account_video_count,
    platform_owned: !!streamCtx.platformOwned,
    refreshed: !!streamCtx.refreshed,
    expires_at: streamCtx.expiresAt ?? null,
  });
}

/**
 * GET /api/stream/videos — live catalog for the selected Cloudflare account.
 */
export async function handleStreamVideosList(env, scope = {}, { limit = 100 } = {}) {
  const streamCtx = await resolveStreamForRequest(env, scope, { requireWrite: false });
  if (!streamCtx.ok) return streamContextErrorResponse(streamCtx, jsonResponse);
  try {
    const { videos, total, customerSubdomain, accountId } = await listStreamVideos(streamCtx, {
      limit,
    });
    const mapped = videos.map((v) => mapStreamVideoRow(v, accountId || streamCtx.accountId));
    // Best-effort metadata sync for account-scoped identity
    for (const v of videos.slice(0, 40)) {
      await upsertStreamMediaAsset(env, {
        streamCtx,
        video: v,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        tenantId: scope.tenantId,
      });
    }
    return jsonResponse({
      ok: true,
      total,
      account_id: streamCtx.accountId,
      customer_subdomain:
        customerSubdomain || mapped.find((v) => v.customer_subdomain)?.customer_subdomain || null,
      credential_source: streamCtx.source,
      platform_owned: !!streamCtx.platformOwned,
      videos: mapped,
    });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e?.message || e).slice(0, 400) }, 502);
  }
}

/**
 * Dispatcher for /api/stream/videos/:uid/* and /api/stream/from-url, /api/stream/direct-upload,
 * /api/stream/capabilities.
 */
export async function handleStreamVideosDetailApi(request, url, env, _ctx, scope = {}) {
  const path = url.pathname.replace(/\/$/, '') || '/';
  const method = (request.method || 'GET').toUpperCase();

  if (path === '/api/stream/capabilities' && method === 'GET') {
    return handleStreamCapabilities(env, scope);
  }

  if (path === '/api/stream/from-url' && method === 'POST') {
    const streamCtx = await resolveStreamForRequest(env, scope, { requireWrite: true });
    if (!streamCtx.ok) return streamContextErrorResponse(streamCtx, jsonResponse);
    const body = await readJsonBody(request);
    const srcUrl = String(body.url || '').trim();
    if (!srcUrl) return jsonResponse({ error: 'url required' }, 400);
    try {
      const meta = { ...(body.meta || {}) };
      if (body.name) meta.name = String(body.name).trim();
      const result = await copyStreamVideoFromUrl(streamCtx, {
        url: srcUrl,
        meta,
        requireSignedURLs: body.require_signed_urls,
      });
      await upsertStreamMediaAsset(env, {
        streamCtx,
        video: result,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        tenantId: scope.tenantId,
        providerStatus: result?.status?.state || 'queued',
      });
      return jsonResponse({
        ok: true,
        video: await mapDetail(result, streamCtx.accountId, env, streamCtx),
      });
    } catch (e) {
      return jsonResponse({ ok: false, error: String(e?.message || e).slice(0, 400) }, 502);
    }
  }

  if (path === '/api/stream/direct-upload' && method === 'POST') {
    const streamCtx = await resolveStreamForRequest(env, scope, { requireWrite: true });
    if (!streamCtx.ok) return streamContextErrorResponse(streamCtx, jsonResponse);
    const body = await readJsonBody(request);
    try {
      const meta = { ...(body.meta || {}) };
      if (body.name) meta.name = String(body.name).trim();
      const result = await createStreamDirectUpload(streamCtx, {
        maxDurationSeconds: body.max_duration_seconds,
        meta: Object.keys(meta).length ? meta : undefined,
        requireSignedURLs: body.require_signed_urls,
      });
      const uid = result?.uid || null;
      if (uid) {
        await upsertStreamMediaAsset(env, {
          streamCtx,
          video: { uid, meta, status: { state: 'uploading' }, readyToStream: false },
          userId: scope.userId,
          workspaceId: scope.workspaceId,
          tenantId: scope.tenantId,
          providerStatus: 'uploading',
        });
      }
      return jsonResponse({
        ok: true,
        upload_url: result?.uploadURL || result?.uploadUrl || null,
        uid,
        account_id: streamCtx.accountId,
        credential_source: streamCtx.source,
      });
    } catch (e) {
      return jsonResponse({ ok: false, error: String(e?.message || e).slice(0, 400) }, 502);
    }
  }

  const uidMatch = path.match(/^\/api\/stream\/videos\/([^/]+)(?:\/(.*))?$/);
  if (!uidMatch) return null;
  const uid = decodeURIComponent(uidMatch[1]);
  const sub = uidMatch[2] || '';
  if (!uid) return jsonResponse({ error: 'uid required' }, 400);

  const isMutation =
    method === 'PATCH' ||
    method === 'POST' ||
    method === 'DELETE' ||
    (sub === 'playback-token' && method === 'POST');

  const streamCtx = await resolveStreamForRequest(env, scope, {
    requireWrite: isMutation && sub !== 'playback-token',
  });
  // playback-token needs read; mint may need write on some accounts — require write for safety
  if (sub === 'playback-token' && method === 'POST') {
    const writeCtx = await resolveStreamForRequest(env, scope, { requireWrite: true });
    if (!writeCtx.ok) return streamContextErrorResponse(writeCtx, jsonResponse);
    Object.assign(streamCtx, writeCtx);
  }
  if (!streamCtx.ok) return streamContextErrorResponse(streamCtx, jsonResponse);

  const accountId = streamCtx.accountId;

  try {
    if (!sub) {
      if (method === 'GET') {
        const video = await assertStreamUidInAccount(env, streamCtx, uid);
        await upsertStreamMediaAsset(env, {
          streamCtx,
          video,
          userId: scope.userId,
          workspaceId: scope.workspaceId,
          tenantId: scope.tenantId,
        });
        return jsonResponse({ ok: true, video: await mapDetail(video, accountId, env, streamCtx) });
      }
      if (method === 'PATCH') {
        await assertStreamUidInAccount(env, streamCtx, uid);
        const body = await readJsonBody(request);
        const current = await getStreamVideoDetail(streamCtx, uid);
        const meta = { ...(current?.meta || {}) };
        if (body.name !== undefined) meta.name = String(body.name || '').trim();
        const updated = await updateStreamVideoDetail(streamCtx, uid, {
          meta,
          requireSignedURLs: body.require_signed_urls,
          allowedOrigins: body.allowed_origins,
          thumbnailTimestampPct: body.thumbnail_timestamp_pct,
        });
        await upsertStreamMediaAsset(env, {
          streamCtx,
          video: updated,
          userId: scope.userId,
          workspaceId: scope.workspaceId,
          tenantId: scope.tenantId,
        });
        return jsonResponse({
          ok: true,
          video: await mapDetail(updated, accountId, env, streamCtx),
        });
      }
      if (method === 'DELETE') {
        await assertStreamUidInAccount(env, streamCtx, uid);
        await deleteStreamVideo(streamCtx, uid);
        if (env.DB) {
          await env.DB.prepare(
            `UPDATE media_assets SET provider_status = 'deleted', status = 'archived', updated_at = datetime('now')
             WHERE stream_uid = ? AND cloudflare_account_id = ?`,
          )
            .bind(uid, accountId)
            .run()
            .catch(() => {});
        }
        return jsonResponse({ ok: true, uid });
      }
    }

    if (sub === 'playback-token' && method === 'POST') {
      await assertStreamUidInAccount(env, streamCtx, uid);
      const body = await readJsonBody(request);
      const minted = await createStreamPlaybackToken(streamCtx, uid, {
        expiresInSeconds: body.expires_in_seconds || body.exp_seconds || 3600,
      });
      return jsonResponse({
        ok: true,
        uid,
        token: minted.token,
        expires_at: minted.expires_at,
        account_id: accountId,
      });
    }

    if (sub === 'downloads') {
      await assertStreamUidInAccount(env, streamCtx, uid);
      if (method === 'GET') {
        const downloads = await getStreamDownloads(streamCtx, uid);
        return jsonResponse({ ok: true, downloads });
      }
      if (method === 'POST') {
        const downloads = await enableStreamDownloads(streamCtx, uid);
        return jsonResponse({ ok: true, downloads });
      }
      if (method === 'DELETE') {
        await deleteStreamDownloads(streamCtx, uid);
        return jsonResponse({ ok: true, uid });
      }
    }

    if (sub === 'captions') {
      await assertStreamUidInAccount(env, streamCtx, uid);
      if (method === 'GET') {
        const captions = await listStreamCaptions(streamCtx, uid);
        return jsonResponse({ ok: true, captions });
      }
      if (method === 'POST') {
        const body = await readJsonBody(request);
        const language = String(body.language || '').trim();
        const vtt = String(body.vtt || body.vtt_content || '');
        if (!language || !vtt) return jsonResponse({ error: 'language and vtt required' }, 400);
        const result = await putStreamCaption(streamCtx, uid, language, vtt);
        return jsonResponse({ ok: true, caption: result });
      }
    }
    const captionDeleteMatch = sub.match(/^captions\/([^/]+)$/);
    if (captionDeleteMatch && method === 'DELETE') {
      await assertStreamUidInAccount(env, streamCtx, uid);
      const language = decodeURIComponent(captionDeleteMatch[1]);
      await deleteStreamCaption(streamCtx, uid, language);
      return jsonResponse({ ok: true, uid, language });
    }

    if (sub === 'public-details') {
      await assertStreamUidInAccount(env, streamCtx, uid);
      const current = await getStreamVideoDetail(streamCtx, uid);
      if (method === 'GET') {
        return jsonResponse({ ok: true, public_details: current?.meta?.iam_public_details || {} });
      }
      if (method === 'PATCH') {
        const body = await readJsonBody(request);
        const meta = { ...(current?.meta || {}) };
        const prev = meta.iam_public_details || {};
        meta.iam_public_details = {
          title: body.title ?? prev.title ?? '',
          logo: body.logo ?? prev.logo ?? '',
          share: body.share ?? prev.share ?? true,
          channel_link: body.channel_link ?? prev.channel_link ?? '',
        };
        const updated = await updateStreamVideoDetail(streamCtx, uid, { meta });
        return jsonResponse({ ok: true, public_details: updated?.meta?.iam_public_details || {} });
      }
    }

    if (sub === 'embed') {
      await assertStreamUidInAccount(env, streamCtx, uid);
      const current = await getStreamVideoDetail(streamCtx, uid);
      const urls = buildStreamWatchUrls(uid, { video: current, accountId });
      if (method === 'GET') {
        const embed = current?.meta?.iam_embed || {};
        return jsonResponse({
          ok: true,
          embed,
          iframe_url: urls.iframe_url,
          url_error: urls.url_error,
          iframe_snippet: urls.iframe_url
            ? `<iframe src="${urls.iframe_url}" style="border:none" height="720" width="1280" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;" allowfullscreen="true"></iframe>`
            : null,
        });
      }
      if (method === 'PATCH') {
        const body = await readJsonBody(request);
        const meta = { ...(current?.meta || {}) };
        const prev = meta.iam_embed || {};
        meta.iam_embed = {
          poster_time: body.poster_time ?? prev.poster_time ?? 0,
          start_time: body.start_time ?? prev.start_time ?? 0,
          controls: body.controls ?? prev.controls ?? true,
          autoplay: body.autoplay ?? prev.autoplay ?? false,
          loop: body.loop ?? prev.loop ?? false,
          preload: body.preload ?? prev.preload ?? 'metadata',
          muted: body.muted ?? prev.muted ?? false,
          lazy: body.lazy ?? prev.lazy ?? true,
          primary_color: body.primary_color ?? prev.primary_color ?? '#f6821f',
        };
        const updated = await updateStreamVideoDetail(streamCtx, uid, { meta });
        return jsonResponse({ ok: true, embed: updated?.meta?.iam_embed || {} });
      }
    }

    if (sub === 'json' && method === 'GET') {
      const video = await assertStreamUidInAccount(env, streamCtx, uid);
      return jsonResponse({
        ok: true,
        curl: `curl -H "Authorization: Bearer <token>" https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${uid}`,
        response: video,
        credential_source: streamCtx.source,
      });
    }

    if (sub === 'tags') {
      await assertStreamUidInAccount(env, streamCtx, uid);
      const tagOpts = {
        ...STREAM_TAG_OPTS,
        accountId: streamCtx.accountId,
        token: streamCtx.token,
      };
      if (method === 'GET') {
        const tagRes = await getResourceTags(env, uid, tagOpts);
        if (!tagRes.ok && !tagRes.beta_untagged && !tagRes.empty) {
          return jsonResponse(
            { ok: false, error: tagRes.error || 'Resource Tagging GET failed', resource_tags: {} },
            tagRes.status || 502,
          );
        }
        return jsonResponse({
          ok: true,
          resource_tags: tagRes.tags || {},
          resource_type: RESOURCE_TYPE_STREAM_VIDEO,
          tags: Object.keys(tagRes.tags || {}),
        });
      }
      if (method === 'PATCH') {
        const body = await readJsonBody(request);
        const next = resourceTagsFromBody(body);
        const put = await setResourceTags(env, uid, next, tagOpts);
        if (!put.ok) {
          return jsonResponse(
            { ok: false, error: put.error || 'Resource Tagging PUT failed', resource_tags: {} },
            put.status || 502,
          );
        }
        return jsonResponse({
          ok: true,
          resource_tags: put.tags || next,
          resource_type: RESOURCE_TYPE_STREAM_VIDEO,
          tags: Object.keys(put.tags || next),
        });
      }
    }

    return jsonResponse({ error: 'Stream video route not matched' }, 404);
  } catch (e) {
    const status = Number(e?.status) || 502;
    return jsonResponse({ ok: false, error: String(e?.message || e).slice(0, 400) }, status);
  }
}

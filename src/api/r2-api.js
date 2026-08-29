/**
 * API Service: R2 Storage Operations
 * Handles bucket management, object CRUD, search, and cross-bucket sync.
 * Deconstructed from legacy worker.js.
 */

import { getAuthUser, jsonResponse } from '../core/auth.js';
import { loadUserCloudflareR2Credentials } from '../core/user-storage-r2-credentials.js';
import { resolveEffectiveWorkspaceId } from '../../backend/identity/bootstrap.js';
import { mergeR2S3EnvFromUserStorage } from '../core/user-storage-r2-credentials.js';
import {
  assertDashboardR2BucketAccess,
  applyWorkspaceR2Transport,
  listDashboardVisibleR2Buckets,
  listWorkerR2BindingCatalog,
  getR2Binding,
  resolveR2BucketName,
  WORKER_R2_BINDING_SPECS,
} from '../core/r2-storage-scope.js';
import { canAccessMediaObjectKey } from '../core/media-r2-access.js';
import { detectFileKind, isEditableTextKind } from '../core/file-kind.js';
import {
  getR2S3Host,
  r2DeleteManyViaBindingOrS3,
  r2DeleteViaBindingOrS3,
  r2FetchObjectViaBindingOrS3,
  r2HeadViaBindingOrS3,
  r2ObjectGetResponse,
  r2PutViaBindingOrS3,
  signR2Request,
} from '../core/r2.js';
import {
  MULTIPART_THRESHOLD_BYTES,
  RECOMMENDED_PART_SIZE,
  assertUploadSize,
  normalizeR2ObjectKey,
} from '../core/r2-keys.js';
import { resolveIdentity } from '../../backend/identity/index.js';
import {
  r2AbortMultipartUpload,
  r2CompleteMultipartUpload,
  r2CreateMultipartUpload,
  r2UploadMultipartPart,
} from '../core/r2-multipart.js';

export {
  getR2Binding,
  resolveR2BucketName,
} from '../core/r2-storage-scope.js';

/** Primary dashboard asset bucket (logical name); bindings may alias legacy names to the same bucket. */
export function isDashboardMediaBucket(name) {
  return name === 'inneranimalmedia';
}

const DASHBOARD_MEDIA_KEY_PREFIXES = [
  'users/',
  'workspace-media/',
  'uploads/',
  'media/',
  'captures/',
  'moviemode/',
  'cms/themes/',
  'cms/pages/',
  'cms/sections/',
  'workspaces/',
  'projects/',
];

function isDashboardMediaScopedKey(key) {
  return DASHBOARD_MEDIA_KEY_PREFIXES.some((p) => key.startsWith(p));
}

async function assertR2ObjectAccess(request, env, bucket, key) {
  if (!isDashboardMediaBucket(bucket) || !isDashboardMediaScopedKey(key)) return null;
  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!(await canAccessMediaObjectKey(env, authUser, key))) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }
  return null;
}

function resolveR2Access(env, bucketOrBinding) {
  const bucketName = resolveR2BucketName(env, bucketOrBinding);
  return { bucketName, binding: getR2Binding(env, bucketName) };
}

function hasR2S3Credentials(env) {
  return !!(env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && getR2S3Host(env));
}

/** Account-wide S3 API requires an authenticated dashboard user when no Worker binding exists. */
async function assertR2UnboundS3Auth(request, env, binding) {
  if (binding) return null;
  if (!hasR2S3Credentials(env)) {
    return jsonResponse({ error: 'Bucket not bound and R2 S3 credentials missing' }, 400);
  }
  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  return null;
}

import { insertAiGenerationLog } from './telemetry.js';

async function authWorkspaceContext(request, env) {
  const authUser = await getAuthUser(request, env);
  if (!authUser) return { authUser: null, workspaceId: null, tenantId: null };
  const identity = await resolveIdentity(request, env);
  const workspaceId = identity.workspace?.id || null;
  const tenantId = identity.tenant?.id || authUser.tenant_id || null;
  return {
    authUser,
    workspaceId: workspaceId ? String(workspaceId) : null,
    tenantId: tenantId ? String(tenantId) : null,
  };
}

async function assertR2UploadKey(request, env, rawKey) {
  const { authUser, workspaceId } = await authWorkspaceContext(request, env);
  if (!authUser) return { error: jsonResponse({ error: 'Unauthorized' }, 401) };
  const norm = normalizeR2ObjectKey(rawKey, { workspaceId: workspaceId || undefined });
  if (!norm.ok) return { error: jsonResponse({ error: norm.error || 'invalid_key' }, 400) };
  return { key: norm.key, authUser, workspaceId };
}

async function upsertMediaAssetRow(env, row) {
  if (!env.DB || !row?.bucket || !row?.object_key) return;
  try {
    await env.DB.prepare(
      `INSERT INTO media_assets (
        id, tenant_id, workspace_id, bucket, object_key, filename, content_type, media_kind,
        size_bytes, etag, status, source_kind, metadata_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'registered', 'r2', '{}', datetime('now'))
      ON CONFLICT(workspace_id, bucket, object_key) DO UPDATE SET
        content_type = excluded.content_type,
        media_kind = excluded.media_kind,
        size_bytes = excluded.size_bytes,
        etag = excluded.etag,
        status = 'uploaded',
        updated_at = datetime('now')`,
    )
      .bind(
        row.id || `asset_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
        row.tenant_id || 'unknown',
        row.workspace_id || 'unknown',
        row.bucket,
        row.object_key,
        row.filename || row.object_key.split('/').pop() || row.object_key,
        row.content_type || null,
        row.media_kind || 'unknown',
        row.size_bytes ?? null,
        row.etag || null,
      )
      .run();
  } catch (e) {
    console.warn('[r2] media_assets upsert skipped', e?.message || e);
  }
}

/**
 * Resolve bucket/key/body for PutObject from query string, raw body, or multipart form.
 */
async function parseR2PutPayload(request, url, defaultKeyIfMissing) {
  const ct = (request.headers.get('Content-Type') || '').toLowerCase();
  let bucket = (url.searchParams.get('bucket') || '').trim();
  let key = (url.searchParams.get('key') || '').trim();
  let body = null;
  let contentType = null;

  if (ct.includes('multipart/form-data')) {
    const fd = await request.formData().catch(() => null);
    if (fd) {
      const b = fd.get('bucket');
      const k = fd.get('key');
      if (b != null && String(b).trim()) bucket = String(b).trim();
      if (k != null && String(k).trim()) key = String(k).trim();
      const file = fd.get('file');
      if (file && typeof file !== 'string') {
        body = await file.arrayBuffer();
        contentType = (file.type || '').split(';')[0].trim() || null;
        if (!key && 'name' in file && file.name) {
          key = String(file.name).replace(/^\/+/, '');
        }
      } else {
        const raw = fd.get('content');
        if (raw != null) {
          body = new TextEncoder().encode(String(raw));
          contentType = 'text/plain; charset=utf-8';
        }
      }
    }
  } else {
    body = await request.arrayBuffer();
    const hdrCt = request.headers.get('Content-Type');
    if (hdrCt) contentType = hdrCt.split(';')[0].trim();
  }

  if (!key && defaultKeyIfMissing) key = defaultKeyIfMissing;
  return { bucket, key, body, contentType };
}

/**
 * List one page of objects via binding or S3 API.
 * @returns {Promise<{ objects: Array<{key:string,size?:number,last_modified?:string|null}>, prefixes?: string[], cursor?: string, continuationToken?: string, error?: string }>}
 */
async function listR2ObjectPage(env, bucketName, binding, prefix, opts = {}) {
  const limit = Math.min(5000, Math.max(1, opts.limit || 1000));
  const recursive = opts.recursive === true;

  if (binding?.list) {
    const list = await binding.list({
      prefix: prefix || '',
      delimiter: recursive ? undefined : '/',
      limit,
      cursor: opts.cursor,
    });
    const objects = (list.objects || [])
      .filter((o) => !o.key.endsWith('/'))
      .map((o) => ({
        key: o.key,
        size: o.size ?? 0,
        last_modified: o.uploaded ? new Date(o.uploaded).toISOString() : null,
      }));
    return {
      objects,
      prefixes: list.delimitedPrefixes || list.rolledUpPrefixes || [],
      cursor: list.truncated ? list.cursor : undefined,
    };
  }

  if (!hasR2S3Credentials(env)) {
    return { objects: [], error: 'Binding not available' };
  }

  const queryParams = {
    'list-type': '2',
    prefix: prefix || '',
    'max-keys': String(Math.min(1000, limit)),
  };
  if (!recursive) queryParams.delimiter = '/';
  if (opts.continuationToken) queryParams['continuation-token'] = opts.continuationToken;

  const signed = await signR2Request('GET', bucketName, '', buildR2Query(queryParams), env);
  if (!signed) return { objects: [], error: 'S3 credentials missing' };

  const listResp = await fetch(signed.endpoint, { method: 'GET', headers: signed.headers });
  if (!listResp.ok) return { objects: [], error: `R2 list failed (${listResp.status})` };

  const xml = await listResp.text();
  const parsed = parseListObjectsV2Xml(xml);
  return {
    objects: parsed.objects.map((o) => ({
      key: o.key,
      size: o.size,
      last_modified: o.lastModified,
    })),
    prefixes: parsed.prefixes || [],
    continuationToken: parsed.isTruncated ? parsed.nextContinuationToken : undefined,
  };
}

async function handleR2FileRoute(request, url, platformEnv, userEnv, method, authUser) {
  let body = {};
  if (method !== 'GET' && method !== 'HEAD') {
    try {
      body = await request.clone().json();
    } catch (_) {
      body = {};
    }
  }

  const bucketParam =
    (url.searchParams.get('bucket') || body.bucket || '').trim();
  const key = (url.searchParams.get('key') || body.key || '').trim();
  if (!bucketParam || !key) return jsonResponse({ error: 'bucket and key required' }, 400);

  const access = await assertDashboardR2BucketAccess(platformEnv, authUser, bucketParam);
  if (!access.ok) {
    return jsonResponse(
      { error: access.error, user_message: access.user_message, bucket: access.bucket },
      access.status || 403,
    );
  }

  const env = applyWorkspaceR2Transport(userEnv, platformEnv, access);
  const { bucketName, binding } = resolveR2Access(env, bucketParam);

  if (method === 'DELETE') {
    const s3DeniedDel = await assertR2UnboundS3Auth(request, env, binding);
    if (s3DeniedDel) return s3DeniedDel;
    const denied = await assertR2ObjectAccess(request, env, bucketName, key);
    if (denied) return denied;
    const ok = await r2DeleteViaBindingOrS3(env, binding, bucketName, key);
    if (!ok) return jsonResponse({ error: 'Delete failed' }, 500);
    return jsonResponse({ ok: true, deleted: true, bucket: bucketName, key });
  }

  if (method === 'POST' || method === 'PUT') {
    const s3DeniedPut = await assertR2UnboundS3Auth(request, env, binding);
    if (s3DeniedPut) return s3DeniedPut;
    const denied = await assertR2ObjectAccess(request, env, bucketName, key);
    if (denied) return denied;
    const content = body.content != null ? String(body.content) : '';
    const contentType =
      body.contentType || getContentTypeFromKey(key) || 'text/plain; charset=utf-8';
    const buf = new TextEncoder().encode(content);
    const ok = await r2PutViaBindingOrS3(env, binding, bucketName, key, buf, contentType);
    if (!ok) return jsonResponse({ error: 'Save failed' }, 500);
    return jsonResponse({ ok: true, bucket: bucketName, key });
  }

  if (method === 'HEAD' || method === 'GET') {
    if (method === 'HEAD') {
      const metaHead = await r2HeadViaBindingOrS3(env, binding, bucketName, key);
      if (metaHead) {
        const deniedHead = await assertR2ObjectAccess(request, env, bucketName, key);
        if (deniedHead) return deniedHead;
        return jsonResponse({ ok: true, bucket: bucketName, ...metaHead });
      }
      const s3DeniedHead = await assertR2UnboundS3Auth(request, env, binding);
      if (s3DeniedHead) return s3DeniedHead;
      const deniedHead = await assertR2ObjectAccess(request, env, bucketName, key);
      if (deniedHead) return deniedHead;
      const fallbackHead = await r2HeadViaBindingOrS3(env, binding, bucketName, key);
      if (!fallbackHead) return jsonResponse({ error: 'Not found' }, 404);
      return jsonResponse({ ok: true, bucket: bucketName, ...fallbackHead });
    }

    const meta = await r2HeadViaBindingOrS3(env, binding, bucketName, key);
    if (!meta) {
      const s3DeniedGet = await assertR2UnboundS3Auth(request, env, binding);
      if (s3DeniedGet) return s3DeniedGet;
    }
    if (!meta) return jsonResponse({ error: 'Not found' }, 404);

    const denied = await assertR2ObjectAccess(request, env, bucketName, key);
    if (denied) return denied;

    const ct = meta.contentType || getContentTypeFromKey(key) || 'application/octet-stream';
    const size = meta.size ?? null;
    const proxyUrl = `${url.origin}/api/r2/buckets/${encodeURIComponent(bucketName)}/object/${encodeURIComponent(key)}`;
    const fileKind = detectFileKind({ key, name: key.split('/').pop(), contentType: ct, size });

    if (isEditableTextKind(fileKind)) {
      const fetched = await r2FetchObjectViaBindingOrS3(env, binding, bucketName, key);
      if (!fetched) return jsonResponse({ error: 'Not found' }, 404);
      const content = new TextDecoder('utf-8', { fatal: false }).decode(fetched.body);
      return jsonResponse({
        bucket: bucketName,
        key,
        fileKind,
        content,
        contentType: ct,
        size: fetched.body.byteLength,
      });
    }

    const presigned = await presignR2GetObjectUrl(env, bucketName, key);
    const previewUrl = presigned || proxyUrl;
    return jsonResponse({
      bucket: bucketName,
      key,
      fileKind,
      isImage: fileKind === 'image',
      isBinary: true,
      contentType: ct,
      size,
      previewUrl,
      url: proxyUrl,
      message:
        fileKind === 'video' || fileKind === 'audio'
          ? 'Media object — stream via preview URL (supports Range requests).'
          : 'Binary object — open via preview URL or download.',
    });
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}

/**
 * Primary router for all R2-related API requests.
 */
export async function handleR2Api(request, url, workerEnv) {
  const path = url.pathname.replace(/\/$/, '') || '/';
  const pathLower = path.toLowerCase();
  const method = (request.method || 'GET').toUpperCase();

  const authUser = await getAuthUser(request, workerEnv).catch(() => null);
  const platformEnv = workerEnv;
  const userEnv = await mergeR2S3EnvFromUserStorage(platformEnv, authUser);
  let env = userEnv;

  async function resolveRequestWorkspaceId() {
    if (!authUser) return null;
    const wsRes = await resolveEffectiveWorkspaceId(platformEnv, request, authUser, {});
    const ws = wsRes?.workspaceId != null ? String(wsRes.workspaceId).trim() : '';
    return ws || null;
  }

  async function denyUnlessBucketAllowed(bucketOrBinding) {
    const access = await assertDashboardR2BucketAccess(platformEnv, authUser, bucketOrBinding);
    if (!access.ok) {
      return jsonResponse(
        {
          error: access.error,
          user_message: access.user_message,
          bucket: access.bucket,
        },
        access.status || 403,
      );
    }
    env = applyWorkspaceR2Transport(userEnv, platformEnv, access);
    return null;
  }

  async function userHasByokR2() {
    if (!authUser?.id) return false;
    const creds = await loadUserCloudflareR2Credentials(env, String(authUser.id));
    return !!(creds?.accessKeyId && creds?.secretAccessKey);
  }

  // 1. Buckets & Inventory
  if (pathLower === '/api/r2/buckets' && method === 'GET') {
    const allParam = url.searchParams.get('all');
    const byokConnected = await userHasByokR2();
    const wantAll = allParam === 'true' && byokConnected;
    if (allParam === 'true' && !byokConnected) {
      return jsonResponse(
        {
          error: 'forbidden',
          user_message: 'Connect Cloudflare R2 in Settings → Storage to list all account buckets.',
        },
        403,
      );
    }
    const payload = await listR2BucketsForCatalog(platformEnv, {
      all: wantAll,
      authUser,
      workspaceId: await resolveRequestWorkspaceId(),
    });
    return jsonResponse(payload);
  }

  if (pathLower === '/api/r2/buckets' && method === 'POST') {
    let body = {};
    try {
      body = await request.clone().json();
    } catch (_) {
      body = {};
    }
    const rawName = body.name != null ? String(body.name).trim() : '';
    if (!rawName) return jsonResponse({ error: 'name required' }, 400);
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(rawName)) {
      return jsonResponse(
        { error: 'Invalid bucket name (3–63 chars, lowercase letters, numbers, hyphens)' },
        400,
      );
    }
    const s3Denied = await assertR2UnboundS3Auth(request, env, null);
    if (s3Denied) return s3Denied;
    const created = await createR2BucketViaS3(env, rawName);
    if (!created.ok) {
      return jsonResponse({ error: created.error || 'create_failed', status: created.status }, created.status || 400);
    }
    return jsonResponse({ ok: true, bucket: rawName });
  }

  if (pathLower === '/api/r2/stats' && method === 'GET' && url.searchParams.get('bucket')) {
    const b = url.searchParams.get('bucket').trim();
    const denied = await denyUnlessBucketAllowed(b);
    if (denied) return denied;
    const { binding } = resolveR2Access(env, b);
    const s3Denied = await assertR2UnboundS3Auth(request, env, binding);
    if (s3Denied) return s3Denied;
    const stats = await r2LiveBucketStats(env, b);
    if (!stats.ok) {
      return jsonResponse({ error: stats.error || 'stats_failed', bucket: b }, stats.status || 400);
    }
    return jsonResponse({ bucket: b, object_count: stats.count, total_bytes: stats.bytes });
  }

  if (pathLower === '/api/r2/sync' && method === 'POST') {
    let syncBody = {};
    try {
      syncBody = await request.clone().json();
    } catch (_) {
      syncBody = {};
    }
    const source_bucket = syncBody.source_bucket != null ? String(syncBody.source_bucket).trim() : '';
    const dest_bucket = syncBody.dest_bucket != null ? String(syncBody.dest_bucket).trim() : '';
    const syncPrefix = syncBody.prefix != null ? String(syncBody.prefix) : '';
    
    if (source_bucket && dest_bucket) {
      const srcDenied = await denyUnlessBucketAllowed(source_bucket);
      if (srcDenied) return srcDenied;
      const dstDenied = await denyUnlessBucketAllowed(dest_bucket);
      if (dstDenied) return dstDenied;
      const src = resolveR2Access(env, source_bucket);
      const dst = resolveR2Access(env, dest_bucket);
      if (!src.binding) {
        const denied = await assertR2UnboundS3Auth(request, env, null);
        if (denied) return denied;
      }
      if (!dst.binding) {
        const denied = await assertR2UnboundS3Auth(request, env, null);
        if (denied) return denied;
      }
      if (!src.binding && !hasR2S3Credentials(env)) {
        return jsonResponse({ error: 'Source bucket not available', source_bucket }, 400);
      }
      if (!dst.binding && !hasR2S3Credentials(env)) {
        return jsonResponse({ error: 'Destination bucket not available', dest_bucket }, 400);
      }

      let copied = 0;
      let bytes = 0;
      const errors = [];
      let cursor;
      let continuationToken;
      do {
        const page = await listR2ObjectPage(env, src.bucketName, src.binding, syncPrefix, {
          limit: 1000,
          cursor,
          continuationToken,
        });
        for (const o of page.objects) {
          if (o.key.endsWith('/')) continue;
          try {
            const fetched = await r2FetchObjectViaBindingOrS3(env, src.binding, src.bucketName, o.key);
            if (!fetched) continue;
            const ct =
              fetched.contentType || getContentTypeFromKey(o.key) || 'application/octet-stream';
            const ok = await r2PutViaBindingOrS3(
              env,
              dst.binding,
              dst.bucketName,
              o.key,
              fetched.body,
              ct,
            );
            if (!ok) {
              errors.push({ key: o.key, error: 'put_failed' });
              continue;
            }
            copied++;
            bytes += fetched.body.byteLength;
          } catch (e) {
            errors.push({ key: o.key, error: String(e?.message || e) });
          }
        }
        cursor = page.cursor;
        continuationToken = page.continuationToken;
      } while (cursor || continuationToken);
      return jsonResponse({ ok: true, copied, bytes, errors: errors.length ? errors : undefined });
    }
  }

  // 2. Object Management
  if (pathLower === '/api/r2/list' && method === 'GET') {
    if (url.searchParams.get('buckets') === 'true') {
      const allParam = url.searchParams.get('all');
      const byokConnected = await userHasByokR2();
      const wantAll = allParam === 'true' && byokConnected;
      if (allParam === 'true' && !byokConnected) {
        return jsonResponse(
          {
            error: 'forbidden',
            user_message: 'Connect Cloudflare R2 in Settings → Storage to list all account buckets.',
          },
          403,
        );
      }
      const payload = await listR2BucketsForCatalog(env, {
        all: wantAll,
        authUser,
        workspaceId: await resolveRequestWorkspaceId(),
      });
      return jsonResponse(payload);
    }

    const bucket = url.searchParams.get('bucket');
    const prefix = url.searchParams.get('prefix') || '';
    const recursive = url.searchParams.get('recursive') === '1' || url.searchParams.get('recursive') === 'true';
    const limitParam = Math.min(5000, Math.max(1, parseInt(url.searchParams.get('limit') || '1000', 10) || 1000));
    const listCursor = (url.searchParams.get('cursor') || '').trim() || undefined;
    const listContinuationToken = (url.searchParams.get('continuation_token') || '').trim() || undefined;
    
    if (!bucket) return jsonResponse({ error: 'bucket required' }, 400);
    const denied = await denyUnlessBucketAllowed(bucket);
    if (denied) return denied;
    const { bucketName, binding } = resolveR2Access(env, bucket);

    const listViaBinding = async () => {
      if (!binding || !binding.list) return null;
      if (recursive) {
        const allObjects = [];
        let cursor;
        do {
          const pageLimit = Math.min(1000, limitParam - allObjects.length);
          if (pageLimit <= 0) break;
          const list = await binding.list({ prefix, limit: pageLimit, cursor });
          for (const o of list.objects || []) {
            if (o.key.endsWith('/')) continue;
            allObjects.push({
              key: o.key,
              size: o.size ?? 0,
              last_modified: o.uploaded ? new Date(o.uploaded).toISOString() : null,
            });
            if (allObjects.length >= limitParam) break;
          }
          cursor = list.truncated ? list.cursor : undefined;
        } while (cursor && allObjects.length < limitParam);
        return { objects: allObjects, prefixes: [] };
      }
      const page = await listR2ObjectPage(env, bucketName, binding, prefix, {
        limit: limitParam,
        cursor: listCursor,
        continuationToken: listContinuationToken,
        recursive: false,
      });
      let objects = page.objects || [];
      let prefixes = page.prefixes || [];
      if (!listCursor && !listContinuationToken && prefixes.length === 0 && objects.length === 0) {
        const flat = await binding.list({ prefix, limit: limitParam });
        const derived = deriveShallowR2ListingFromObjects(
          (flat.objects || []).filter((o) => !o.key.endsWith('/')),
          prefix,
        );
        objects = derived.objects;
        prefixes = derived.prefixes;
      }
      return {
        objects,
        prefixes,
        truncated: !!(page.cursor || page.continuationToken),
        cursor: page.cursor,
        continuation_token: page.continuationToken,
      };
    };

    const bindingList = await listViaBinding();
    if (bindingList) return jsonResponse(bindingList);

    const s3Denied = await assertR2UnboundS3Auth(request, env, binding);
    if (s3Denied) return s3Denied;

    const page = await listR2ObjectPage(env, bucketName, binding, prefix, {
      limit: limitParam,
      cursor: listCursor,
      continuationToken: listContinuationToken,
      recursive,
    });
    if (page.error && !(page.objects?.length)) {
      return jsonResponse({ error: page.error }, 400);
    }
    return jsonResponse({
      objects: page.objects || [],
      prefixes: page.prefixes || [],
      truncated: !!(page.cursor || page.continuationToken),
      cursor: page.cursor,
      continuation_token: page.continuationToken,
    });
  }

  if (pathLower === '/api/r2/search' && method === 'GET') {
    const bucket = url.searchParams.get('bucket');
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const keyPrefix = (url.searchParams.get('prefix') || '').trim();
    if (!bucket) return jsonResponse({ error: 'bucket required' }, 400);
    const denied = await denyUnlessBucketAllowed(bucket);
    if (denied) return denied;
    const { bucketName, binding } = resolveR2Access(env, bucket);
    const s3Denied = await assertR2UnboundS3Auth(request, env, binding);
    if (s3Denied) return s3Denied;

    const allObjects = [];
    let cursor;
    let continuationToken;
    do {
      const page = await listR2ObjectPage(env, bucketName, binding, keyPrefix, {
        limit: 500,
        cursor,
        continuationToken,
        recursive: true,
      });
      for (const o of page.objects) {
        if (o.key.endsWith('/')) continue;
        if (q.length >= 2 && !o.key.toLowerCase().includes(q)) continue;
        allObjects.push({
          key: o.key,
          path: o.key,
          name: o.key.split('/').pop() || o.key,
          size: o.size ?? 0,
          last_modified: o.last_modified ?? o.lastModified ?? null,
        });
        if (allObjects.length >= 100) break;
      }
      cursor = page.cursor;
      continuationToken = page.continuationToken;
    } while ((cursor || continuationToken) && allObjects.length < 100);
    return jsonResponse({ objects: allObjects });
  }

  if ((pathLower === '/api/r2/upload' && method === 'POST') || (pathLower === '/api/r2/put' && method === 'PUT')) {
    const defaultKey =
      pathLower === '/api/r2/upload' ? `upload/${Date.now()}-${crypto.randomUUID().slice(0, 8)}` : null;
    const parsed = await parseR2PutPayload(request, url, defaultKey);
    const { bucket, key: rawKey, body, contentType: parsedCt } = parsed;
    if (!bucket || !rawKey) return jsonResponse({ error: 'bucket and key required' }, 400);
    if (body == null) return jsonResponse({ error: 'body or file field required' }, 400);

    const keyCheck = await assertR2UploadKey(request, env, rawKey);
    if (keyCheck.error) return keyCheck.error;
    const key = keyCheck.key;

    const sizeCheck = assertUploadSize(body.byteLength);
    if (!sizeCheck.ok) return jsonResponse({ error: sizeCheck.error }, 400);
    if (body.byteLength > MULTIPART_THRESHOLD_BYTES) {
      return jsonResponse(
        {
          error: 'file_too_large_for_single_upload',
          multipartThresholdBytes: MULTIPART_THRESHOLD_BYTES,
          hint: 'Use POST /api/r2/multipart/create then PUT parts and POST complete',
        },
        413,
      );
    }

    const deniedUpload = await denyUnlessBucketAllowed(bucket);
    if (deniedUpload) return deniedUpload;
    const { bucketName, binding } = resolveR2Access(env, bucket);
    const s3Denied = await assertR2UnboundS3Auth(request, env, binding);
    if (s3Denied) return s3Denied;

    const denied = await assertR2ObjectAccess(request, env, bucketName, key);
    if (denied) return denied;

    const contentType = parsedCt || getContentTypeFromKey(key) || 'application/octet-stream';
    const ok = await r2PutViaBindingOrS3(env, binding, bucketName, key, body, contentType);
    if (!ok) return jsonResponse({ error: 'Put failed', bucket: bucketName, key }, 500);

    const kind = detectFileKind({ key, contentType, size: body.byteLength });
    const { tenantId, workspaceId } = await authWorkspaceContext(request, env);
    await upsertMediaAssetRow(env, {
      tenant_id: tenantId,
      workspace_id: workspaceId,
      bucket: bucketName,
      object_key: key,
      content_type: contentType,
      media_kind: kind === 'pdf' ? 'binary' : kind,
      size_bytes: body.byteLength,
    });

    void insertAiGenerationLog(env, {
      generationType: pathLower === '/api/r2/put' ? 'r2_put' : 'r2_upload',
      responseText: `${bucketName}:${key}`,
      metadataJson: { key, byte_length: body.byteLength, content_type: contentType },
    });

    return jsonResponse({
      ok: true,
      key,
      bucket: bucketName,
      url: `${url.origin}/api/r2/buckets/${encodeURIComponent(bucketName)}/object/${encodeURIComponent(key)}`,
    });
  }

  if (pathLower === '/api/r2/delete' && method === 'DELETE') {
    let bucket = url.searchParams.get('bucket');
    let key = url.searchParams.get('key');
    if (!bucket || !key) {
      try {
        const body = await request.clone().json();
        if (!bucket && body?.bucket != null) bucket = String(body.bucket).trim();
        if (!key && body?.key != null) key = String(body.key).trim();
      } catch (_) {
        /* query params only */
      }
    }
    if (!bucket || !key) return jsonResponse({ error: 'bucket and key required' }, 400);
    const deniedDel = await denyUnlessBucketAllowed(bucket);
    if (deniedDel) return deniedDel;
    const { bucketName, binding } = resolveR2Access(env, bucket);
    const s3Denied = await assertR2UnboundS3Auth(request, env, binding);
    if (s3Denied) return s3Denied;

    const denied = await assertR2ObjectAccess(request, env, bucketName, key);
    if (denied) return denied;

    const ok = await r2DeleteViaBindingOrS3(env, binding, bucketName, key);
    if (!ok) return jsonResponse({ error: 'Delete failed', bucket: bucketName, key }, 500);
    return jsonResponse({ ok: true, deleted: true, bucket: bucketName, key });
  }

  if (pathLower === '/api/r2/delete-batch' && method === 'POST') {
    let batchBody = {};
    try {
      batchBody = await request.json();
    } catch (_) {
      batchBody = {};
    }
    const bucket = (batchBody.bucket != null ? String(batchBody.bucket) : url.searchParams.get('bucket') || '').trim();
    const keys = Array.isArray(batchBody.keys) ? batchBody.keys.map((k) => String(k || '').trim()).filter(Boolean) : [];
    if (!bucket || !keys.length) return jsonResponse({ error: 'bucket and keys[] required' }, 400);

    const deniedBatch = await denyUnlessBucketAllowed(bucket);
    if (deniedBatch) return deniedBatch;
    const { bucketName, binding } = resolveR2Access(env, bucket);
    const s3Denied = await assertR2UnboundS3Auth(request, env, binding);
    if (s3Denied) return s3Denied;

    for (const k of keys) {
      const denied = await assertR2ObjectAccess(request, env, bucketName, k);
      if (denied) return denied;
    }

    const result = await r2DeleteManyViaBindingOrS3(env, binding, bucketName, keys);
    return jsonResponse({
      ok: result.errors.length === 0,
      bucket: bucketName,
      deleted: result.deleted,
      errors: result.errors.length ? result.errors : undefined,
    });
  }

  if (pathLower === '/api/r2/head' && (method === 'GET' || method === 'HEAD')) {
    const bucket = url.searchParams.get('bucket');
    const key = url.searchParams.get('key');
    if (!bucket || !key) return jsonResponse({ error: 'bucket and key required' }, 400);
    const deniedHead = await denyUnlessBucketAllowed(bucket);
    if (deniedHead) return deniedHead;
    const { bucketName, binding } = resolveR2Access(env, bucket);
    const meta = await r2HeadViaBindingOrS3(env, binding, bucketName, key);
    if (meta) {
      const denied = await assertR2ObjectAccess(request, env, bucketName, key);
      if (denied) return denied;
      return jsonResponse({ ok: true, bucket: bucketName, ...meta });
    }
    const s3Denied = await assertR2UnboundS3Auth(request, env, binding);
    if (s3Denied) return s3Denied;
    const denied = await assertR2ObjectAccess(request, env, bucketName, key);
    if (denied) return denied;
    const fallbackMeta = await r2HeadViaBindingOrS3(env, binding, bucketName, key);
    if (!fallbackMeta) return jsonResponse({ error: 'Not found' }, 404);
    return jsonResponse({ ok: true, bucket: bucketName, ...fallbackMeta });
  }

  if (pathLower === '/api/r2/copy' && method === 'POST') {
    const bucket = url.searchParams.get('bucket');
    const fromKey = url.searchParams.get('from');
    const toKey = url.searchParams.get('to');
    if (!bucket || !fromKey || !toKey) {
      return jsonResponse({ error: 'bucket, from, and to required' }, 400);
    }
    const deniedCopy = await denyUnlessBucketAllowed(bucket);
    if (deniedCopy) return deniedCopy;
    const { bucketName, binding } = resolveR2Access(env, bucket);
    const s3Denied = await assertR2UnboundS3Auth(request, env, binding);
    if (s3Denied) return s3Denied;

    const deniedFrom = await assertR2ObjectAccess(request, env, bucketName, fromKey);
    if (deniedFrom) return deniedFrom;
    const deniedTo = await assertR2ObjectAccess(request, env, bucketName, toKey);
    if (deniedTo) return deniedTo;

    const fetched = await r2FetchObjectViaBindingOrS3(env, binding, bucketName, fromKey);
    if (!fetched) return jsonResponse({ error: 'Source not found', bucket: bucketName, from: fromKey }, 404);

    const contentType =
      fetched.contentType || getContentTypeFromKey(toKey) || 'application/octet-stream';
    const ok = await r2PutViaBindingOrS3(env, binding, bucketName, toKey, fetched.body, contentType);
    if (!ok) return jsonResponse({ error: 'Copy put failed', bucket: bucketName, to: toKey }, 500);

    return jsonResponse({
      ok: true,
      bucket: bucketName,
      from: fromKey,
      to: toKey,
      bytes: fetched.body.byteLength,
    });
  }

  if (pathLower === '/api/r2/stream' && (method === 'GET' || method === 'HEAD')) {
    const bucketParam = (url.searchParams.get('bucket') || '').trim();
    const key = (url.searchParams.get('key') || '').trim();
    if (!bucketParam || !key) return jsonResponse({ error: 'bucket and key required' }, 400);
    const deniedStream = await denyUnlessBucketAllowed(bucketParam);
    if (deniedStream) return deniedStream;
    const { bucketName, binding } = resolveR2Access(env, bucketParam);
    const streamRes = await r2ObjectGetResponse(request, env, binding, bucketName, key, getContentTypeFromKey(key));
    if (streamRes) {
      const denied = await assertR2ObjectAccess(request, env, bucketName, key);
      if (denied) return denied;
      return streamRes;
    }
    const s3Denied = await assertR2UnboundS3Auth(request, env, binding);
    if (s3Denied) return s3Denied;
    const denied = await assertR2ObjectAccess(request, env, bucketName, key);
    if (denied) return denied;
    const fallbackStreamRes = await r2ObjectGetResponse(request, env, binding, bucketName, key, getContentTypeFromKey(key));
    if (!fallbackStreamRes) return jsonResponse({ error: 'Not found' }, 404);
    return fallbackStreamRes;
  }

  if (pathLower === '/api/r2/file') {
    return handleR2FileRoute(request, url, platformEnv, userEnv, method, authUser);
  }

  if (pathLower === '/api/r2/multipart/create' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const bucketRaw = String(body.bucket || '').trim();
    const keyRaw = String(body.key || '').trim();
    if (!bucketRaw || !keyRaw) return jsonResponse({ error: 'bucket and key required' }, 400);
    const deniedMpCreate = await denyUnlessBucketAllowed(bucketRaw);
    if (deniedMpCreate) return deniedMpCreate;
    const keyCheck = await assertR2UploadKey(request, env, keyRaw);
    if (keyCheck.error) return keyCheck.error;
    const { bucketName, binding } = resolveR2Access(env, bucketRaw);
    const s3Denied = await assertR2UnboundS3Auth(request, env, binding);
    if (s3Denied) return s3Denied;
    const denied = await assertR2ObjectAccess(request, env, bucketName, keyCheck.key);
    if (denied) return denied;
    const contentType = body.contentType || getContentTypeFromKey(keyCheck.key) || 'application/octet-stream';
    const meta = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
    const created = await r2CreateMultipartUpload(env, binding, bucketName, keyCheck.key, contentType, meta);
    if (created.error) return jsonResponse({ error: created.error, detail: created.detail }, 500);
    return jsonResponse({
      ok: true,
      bucket: bucketName,
      key: keyCheck.key,
      uploadId: created.uploadId,
      recommendedPartSize: RECOMMENDED_PART_SIZE,
      multipartThresholdBytes: MULTIPART_THRESHOLD_BYTES,
    });
  }

  if (pathLower === '/api/r2/multipart/part' && method === 'PUT') {
    const bucketRaw = (url.searchParams.get('bucket') || '').trim();
    const keyRaw = (url.searchParams.get('key') || '').trim();
    const uploadId = (url.searchParams.get('uploadId') || '').trim();
    const partNumber = parseInt(url.searchParams.get('partNumber') || '0', 10);
    if (!bucketRaw || !keyRaw || !uploadId || !partNumber) {
      return jsonResponse({ error: 'bucket, key, uploadId, partNumber required' }, 400);
    }
    const deniedMpPart = await denyUnlessBucketAllowed(bucketRaw);
    if (deniedMpPart) return deniedMpPart;
    const keyCheck = await assertR2UploadKey(request, env, keyRaw);
    if (keyCheck.error) return keyCheck.error;
    const { bucketName, binding } = resolveR2Access(env, bucketRaw);
    const s3Denied = await assertR2UnboundS3Auth(request, env, binding);
    if (s3Denied) return s3Denied;
    const denied = await assertR2ObjectAccess(request, env, bucketName, keyCheck.key);
    if (denied) return denied;
    const buf = await request.arrayBuffer();
    const sizeCheck = assertUploadSize(buf.byteLength);
    if (!sizeCheck.ok) return jsonResponse({ error: sizeCheck.error }, 400);
    const part = await r2UploadMultipartPart(
      env,
      binding,
      bucketName,
      keyCheck.key,
      uploadId,
      partNumber,
      buf,
    );
    if (!part.ok) return jsonResponse({ error: part.error, detail: part.detail }, 500);
    return jsonResponse({
      ok: true,
      partNumber: part.partNumber,
      etag: part.etag,
      size: part.size,
    });
  }

  if (pathLower === '/api/r2/multipart/complete' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const bucketRaw = String(body.bucket || '').trim();
    const keyRaw = String(body.key || '').trim();
    const uploadId = String(body.uploadId || '').trim();
    const parts = Array.isArray(body.parts) ? body.parts : [];
    if (!bucketRaw || !keyRaw || !uploadId || !parts.length) {
      return jsonResponse({ error: 'bucket, key, uploadId, parts[] required' }, 400);
    }
    const deniedMpComplete = await denyUnlessBucketAllowed(bucketRaw);
    if (deniedMpComplete) return deniedMpComplete;
    const keyCheck = await assertR2UploadKey(request, env, keyRaw);
    if (keyCheck.error) return keyCheck.error;
    const { bucketName, binding } = resolveR2Access(env, bucketRaw);
    const s3Denied = await assertR2UnboundS3Auth(request, env, binding);
    if (s3Denied) return s3Denied;
    const denied = await assertR2ObjectAccess(request, env, bucketName, keyCheck.key);
    if (denied) return denied;
    const done = await r2CompleteMultipartUpload(
      env,
      binding,
      bucketName,
      keyCheck.key,
      uploadId,
      parts,
    );
    if (!done.ok) return jsonResponse({ error: done.error, detail: done.detail }, 500);
    const head = await r2HeadViaBindingOrS3(env, binding, bucketName, keyCheck.key);
    const ct = head?.contentType || getContentTypeFromKey(keyCheck.key) || 'application/octet-stream';
    const kind = detectFileKind({ key: keyCheck.key, contentType: ct, size: head?.size });
    const { tenantId, workspaceId } = await authWorkspaceContext(request, env);
    await upsertMediaAssetRow(env, {
      tenant_id: tenantId,
      workspace_id: workspaceId,
      bucket: bucketName,
      object_key: keyCheck.key,
      content_type: ct,
      media_kind: kind === 'pdf' ? 'binary' : kind,
      size_bytes: head?.size ?? null,
      etag: done.etag || head?.etag || null,
    });
    void insertAiGenerationLog(env, {
      generationType: 'r2_multipart_complete',
      responseText: `${bucketName}:${keyCheck.key}`,
      metadataJson: { key: keyCheck.key, parts: parts.length, etag: done.etag },
    });
    return jsonResponse({
      ok: true,
      bucket: bucketName,
      key: keyCheck.key,
      etag: done.etag,
      url: `${url.origin}/api/r2/buckets/${encodeURIComponent(bucketName)}/object/${encodeURIComponent(keyCheck.key)}`,
    });
  }

  if (pathLower === '/api/r2/multipart/abort' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const bucketRaw = String(body.bucket || '').trim();
    const keyRaw = String(body.key || '').trim();
    const uploadId = String(body.uploadId || '').trim();
    if (!bucketRaw || !keyRaw || !uploadId) {
      return jsonResponse({ error: 'bucket, key, uploadId required' }, 400);
    }
    const deniedMpAbort = await denyUnlessBucketAllowed(bucketRaw);
    if (deniedMpAbort) return deniedMpAbort;
    const { bucketName, binding } = resolveR2Access(env, bucketRaw);
    const s3Denied = await assertR2UnboundS3Auth(request, env, binding);
    if (s3Denied) return s3Denied;
    const aborted = await r2AbortMultipartUpload(env, binding, bucketName, keyRaw, uploadId);
    if (!aborted.ok) return jsonResponse({ error: aborted.error }, 500);
    return jsonResponse({ ok: true, aborted: true });
  }

  if (pathLower === '/api/r2/url' && method === 'GET') {
    const bucket = url.searchParams.get('bucket');
    const key = url.searchParams.get('key');
    const exp = parseInt(url.searchParams.get('expires') || '3600', 10);
    if (!bucket || !key) return jsonResponse({ error: 'bucket and key required' }, 400);
    const deniedUrl = await denyUnlessBucketAllowed(bucket);
    if (deniedUrl) return deniedUrl;
    
    const workerUrl = `${url.origin}/api/r2/buckets/${encodeURIComponent(bucket)}/object/${encodeURIComponent(key)}`;
    const presigned = await presignR2GetObjectUrl(env, bucket, key, exp);
    return jsonResponse({ url: workerUrl, presigned_s3_url: presigned });
  }

  // 3. Dynamic Sub-routes
  const bucketsObjectsMatch = path.match(/^\/api\/r2\/buckets\/([^/]+)\/objects$/i);
  if (bucketsObjectsMatch && method === 'GET') {
    const name = decodeURIComponent(bucketsObjectsMatch[1]);
    const deniedInv = await denyUnlessBucketAllowed(name);
    if (deniedInv) return deniedInv;
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const { results } = await env.DB.prepare('SELECT * FROM r2_object_inventory WHERE bucket_name = ? ORDER BY object_key').bind(name).all();
    return jsonResponse({ objects: results || [] });
  }

  const objectKeyMatch = path.match(/^\/api\/r2\/buckets\/([^/]+)\/object\/(.+)$/i);
  if (objectKeyMatch) {
    const name = decodeURIComponent(objectKeyMatch[1]);
    const key = decodeURIComponent(objectKeyMatch[2]);
    const deniedObj = await denyUnlessBucketAllowed(name);
    if (deniedObj) return deniedObj;
    const { bucketName, binding } = resolveR2Access(env, name);

    if (method === 'GET' || method === 'HEAD') {
      const s3Denied = await assertR2UnboundS3Auth(request, env, binding);
      if (s3Denied) return s3Denied;
      const deniedGet = await assertR2ObjectAccess(request, env, bucketName, key);
      if (deniedGet) return deniedGet;
      const streamRes = await r2ObjectGetResponse(
        request,
        env,
        binding,
        bucketName,
        key,
        getContentTypeFromKey(key),
      );
      if (!streamRes) return jsonResponse({ error: 'Not found' }, 404);
      const headers = new Headers(streamRes.headers);
      headers.set('Content-Disposition', 'inline');
      return new Response(streamRes.body, { status: streamRes.status, headers });
    }

    if (method === 'PUT') {
      const s3Denied = await assertR2UnboundS3Auth(request, env, binding);
      if (s3Denied) return s3Denied;
      const deniedPut = await assertR2ObjectAccess(request, env, bucketName, key);
      if (deniedPut) return deniedPut;
      const ct = request.headers.get('Content-Type') || getContentTypeFromKey(key) || 'application/octet-stream';
      const buf = await request.arrayBuffer();
      const ok = await r2PutViaBindingOrS3(env, binding, bucketName, key, buf, ct);
      if (!ok) return jsonResponse({ error: 'Put failed' }, 500);
      return jsonResponse({ ok: true, key, bucket: bucketName });
    }

    if (method === 'DELETE') {
      const s3Denied = await assertR2UnboundS3Auth(request, env, binding);
      if (s3Denied) return s3Denied;
      const deniedDel = await assertR2ObjectAccess(request, env, bucketName, key);
      if (deniedDel) return deniedDel;
      const ok = await r2DeleteViaBindingOrS3(env, binding, bucketName, key);
      if (!ok) return jsonResponse({ error: 'Delete failed' }, 500);
      return jsonResponse({ ok: true, deleted: true, bucket: bucketName, key });
    }
  }

  return jsonResponse({ error: 'R2 route not matched' }, 404);
}

// --- HELPER FUNCTIONS (exported for storage dashboard API) ---

/**
 * Bound buckets, optionally merged with account-wide S3 ListBuckets (same as GET /api/r2/list?buckets=true&all=true).
 * @param {any} env
 * @param {{ all?: boolean }} [opts]
 */
export async function listR2BucketsForCatalog(env, opts = {}) {
  const visible = await listDashboardVisibleR2Buckets(env, opts.authUser ?? null, {
    // Pass through undefined so platform owners default to account-wide S3 catalog.
    // Explicit false keeps bindings-only; explicit true forces account list.
    all: opts.all,
    listAccountViaS3: listAllR2BucketsViaS3,
    workspaceId: opts.workspaceId ?? null,
  });
  const resolve = buildR2BucketResolveMap(env);
  return { ...visible, resolve };
}

/**
 * List one page of objects in a bucket (binding or S3 — supports unbound buckets).
 * @param {any} env
 * @param {{ bucket?: string, prefix?: string, limit?: number, recursive?: boolean }} opts
 */
export async function listR2ObjectsForCatalog(env, opts = {}) {
  const bucket = String(opts.bucket || '').trim();
  if (!bucket) {
    return { ok: false, error: 'bucket_required', user_message: 'R2 object listing requires bucket.' };
  }
  const prefix = String(opts.prefix || '').trim();
  const limit = Math.min(1000, Math.max(1, Number(opts.limit) || 100));
  const cursor = String(opts.cursor || '').trim() || undefined;
  const { bucketName, binding } = resolveR2Access(env, bucket);
  if (!binding && !hasR2S3Credentials(env)) {
    return {
      ok: false,
      error: 'r2_transport_unavailable',
      bucket: bucketName,
      user_message:
        'No Worker binding for this bucket and R2 S3 credentials are not configured.',
    };
  }
  const page = await listR2ObjectPage(env, bucketName, binding, prefix, {
    limit,
    recursive: opts.recursive === true,
    cursor,
    continuationToken: cursor,
  });
  if (page.error && !(page.objects?.length)) {
    return {
      ok: false,
      error: 'list_failed',
      bucket: bucketName,
      message: page.error,
    };
  }
  return {
    ok: true,
    bucket: bucketName,
    prefix,
    objects: page.objects || [],
    prefixes: page.prefixes || [],
    count: (page.objects || []).length,
    truncated: !!(page.cursor || page.continuationToken),
    cursor: page.cursor || page.continuationToken || null,
  };
}

export function listBoundR2BucketNames(env) {
  return listWorkerR2BindingCatalog(env).map((row) => row.bucket_name);
}

/** Stable id for buckets that share the same Worker binding (e.g. inneranimalmedia + tools). */
export function getR2BindingSlot(env, bucketName) {
  const binding = getR2Binding(env, bucketName);
  if (!binding) return `unbound:${String(bucketName || '').trim()}`;
  for (const spec of WORKER_R2_BINDING_SPECS) {
    if (env?.[spec.bindingKey] === binding) return spec.bindingKey;
  }
  return `binding:${String(bucketName || '').trim()}`;
}

/** One row per physical binding — order follows listBoundR2BucketNames (primary name wins). */
export function dedupeBoundR2BucketNames(env) {
  const names = listBoundR2BucketNames(env);
  const seen = new Set();
  const out = [];
  for (const name of names) {
    const slot = getR2BindingSlot(env, name);
    if (seen.has(slot)) continue;
    seen.add(slot);
    out.push(name);
  }
  return out;
}

/** Map any bound bucket / legacy binding label to the display bucket from `dedupeBoundR2BucketNames`. */
export function resolveListedR2BucketName(env, requested, listedOptional) {
  const listed = listedOptional || dedupeBoundR2BucketNames(env);
  const raw = String(requested || '').trim();
  if (!raw) return '';
  if (listed.includes(raw)) return raw;
  const canonical = resolveR2BucketName(env, raw);
  if (listed.includes(canonical)) return canonical;
  const slot = getR2BindingSlot(env, canonical);
  const bySlot = listed.find((n) => getR2BindingSlot(env, n) === slot);
  return bySlot || canonical;
}

export function buildR2BucketResolveMap(env) {
  const listed = dedupeBoundR2BucketNames(env);
  const all = listBoundR2BucketNames(env);
  const map = {};
  for (const name of all) {
    const primary = resolveListedR2BucketName(env, name, listed);
    map[name] = primary;
    map[name.toLowerCase()] = primary;
  }
  for (const [label, bucket] of Object.entries(BINDING_LABEL_TO_BUCKET)) {
    const primary = resolveListedR2BucketName(env, bucket, listed);
    map[label] = primary;
    map[label.toLowerCase()] = primary;
  }
  return map;
}

export async function r2LiveBucketStats(env, bucketName) {
  const { bucketName: resolved, binding } = resolveR2Access(env, bucketName);
  let count = 0;
  let bytes = 0;
  let cursor;
  let continuationToken;
  do {
    const page = await listR2ObjectPage(env, resolved, binding, '', {
      limit: 1000,
      cursor,
      continuationToken,
      recursive: true,
    });
    if (page.error) return { ok: false, error: page.error };
    for (const o of page.objects) {
      if (o.key.endsWith('/')) continue;
      count++;
      bytes += o.size || 0;
    }
    cursor = page.cursor;
    continuationToken = page.continuationToken;
  } while (cursor || continuationToken);
  return { ok: true, count, bytes };
}

function getContentTypeFromKey(key) {
  const ext = (key.split('.').pop() || '').toLowerCase().replace(/[#?].*$/, '');
  const types = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp',
    html: 'text/html', css: 'text/css', js: 'application/javascript', mjs: 'application/javascript',
    json: 'application/json', xml: 'application/xml', txt: 'text/plain', md: 'text/markdown',
    pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav',
  };
  return types[ext] || null;
}

// --- SIGV4 & PRE-SIGNING CORE ---

const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

async function sha256hex(message) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacBytes(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', typeof key === 'string' ? new TextEncoder().encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

async function hmacHex(key, message) {
  const bytes = await hmacBytes(key, message);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getSigningKey(secret, date, region, service) {
  const kDate = await hmacBytes('AWS4' + secret, date);
  const kRegion = await hmacBytes(kDate, region);
  const kService = await hmacBytes(kRegion, service);
  return hmacBytes(kService, 'aws4_request');
}

async function presignR2GetObjectUrl(env, bucket, key, expiresSeconds = 3600) {
  const accessKey = env.R2_ACCESS_KEY_ID;
  const secretKey = env.R2_SECRET_ACCESS_KEY;
  const host = getR2S3Host(env);
  if (!accessKey || !secretKey || !host) return null;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const encodedKey = String(key).split('/').map(seg => encodeURIComponent(seg)).join('/');
  
  const params = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKey}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host'
  });
  
  const sortedPairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const canonicalQueryString = sortedPairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const canonicalRequest = ['GET', `/${bucket}/${encodedKey}`, canonicalQueryString, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, await sha256hex(canonicalRequest)].join('\n');
  const signingKey = await getSigningKey(secretKey, dateStamp, 'auto', 's3');
  const signature = await hmacHex(signingKey, stringToSign);
  
  return `https://${host}/${bucket}/${encodedKey}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

/** When delimiter listing returns empty, derive folders/files from a flat page of keys. */
function deriveShallowR2ListingFromObjects(rawObjects, currentPrefix) {
  const p = String(currentPrefix || '').replace(/\/$/, '');
  const pfx = p ? `${p}/` : '';
  const folderSet = new Set();
  const files = [];
  for (const o of rawObjects) {
    const k = String(o?.key || '');
    if (!k.startsWith(pfx)) continue;
    const rest = k.slice(pfx.length);
    const slash = rest.indexOf('/');
    if (slash < 0) {
      files.push({
        key: k,
        size: o.size ?? 0,
        last_modified: o.uploaded ? new Date(o.uploaded).toISOString() : null,
      });
    } else {
      folderSet.add(pfx + rest.slice(0, slash + 1));
    }
  }
  return {
    objects: files,
    prefixes: [...folderSet].sort((a, b) => a.localeCompare(b)),
  };
}

/** S3 PutBucket — create a new R2 bucket in the account. */
async function createR2BucketViaS3(env, bucketName) {
  const signed = await signR2Request('PUT', bucketName, '', '', env);
  if (!signed) return { ok: false, error: 'R2 S3 credentials missing', status: 400 };
  const putResp = await fetch(signed.endpoint, { method: 'PUT', headers: signed.headers });
  if (putResp.ok || putResp.status === 409) {
    return { ok: true };
  }
  const errText = await putResp.text().catch(() => '');
  return {
    ok: false,
    error: errText?.slice(0, 200) || `R2 create bucket failed (${putResp.status})`,
    status: putResp.status,
  };
}

/** S3 ListBuckets (account-wide) when R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY are set. */
async function listAllR2BucketsViaS3(env) {
  const accessKey = env.R2_ACCESS_KEY_ID;
  const secretKey = env.R2_SECRET_ACCESS_KEY;
  const host = getR2S3Host(env);
  if (!accessKey || !secretKey || !host) return null;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const endpoint = `https://${host}/`;
  const headerMap = { host, 'x-amz-content-sha256': EMPTY_HASH, 'x-amz-date': amzDate };
  const sortedKeys = Object.keys(headerMap).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${headerMap[k]}\n`).join('');
  const signedHeaders = sortedKeys.join(';');
  const canonicalRequest = ['GET', '/', '', canonicalHeaders, signedHeaders, EMPTY_HASH].join('\n');
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, await sha256hex(canonicalRequest)].join('\n');
  const signingKey = await getSigningKey(secretKey, dateStamp, 'auto', 's3');
  const signature = await hmacHex(signingKey, stringToSign);
  const headers = {
    ...headerMap,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };

  const listResp = await fetch(endpoint, { method: 'GET', headers });
  if (!listResp.ok) return null;
  return parseListBucketsXml(await listResp.text());
}

function parseListBucketsXml(xml) {
  const buckets = [];
  const blocks = xml.match(/<Bucket>[\s\S]*?<\/Bucket>/gi) || [];
  for (const block of blocks) {
    const name = (block.match(/<Name>([^<]*)<\/Name>/i) || [])[1];
    if (name) buckets.push(name);
  }
  return buckets.sort((a, b) => a.localeCompare(b));
}

function parseListObjectsV2Xml(xml) {
  const objects = [];
  const prefixes = [];
  const contentsBlocks = xml.match(/<Contents>[\s\S]*?<\/Contents>/g) || [];
  for (const block of contentsBlocks) {
    const key = (block.match(/<Key>([^<]*)<\/Key>/) || [])[1] || '';
    const size = parseInt((block.match(/<Size>([^<]*)<\/Size>/) || [])[1] || '0', 10);
    const lastModified = (block.match(/<LastModified>([^<]*)<\/LastModified>/) || [])[1] || null;
    objects.push({ key, size, lastModified });
  }
  const prefixBlocks = xml.match(/<CommonPrefixes>[\s\S]*?<\/CommonPrefixes>/g) || [];
  for (const block of prefixBlocks) {
    const prefix = (block.match(/<Prefix>([^<]*)<\/Prefix>/) || [])[1];
    if (prefix) prefixes.push(prefix);
  }
  const isTruncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
  const nextContinuationToken =
    (xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/i) || [])[1] || undefined;
  return { objects, prefixes, isTruncated, nextContinuationToken };
}

function buildR2Query(params) {
  const keys = Object.keys(params).filter(k => params[k] != null && params[k] !== '');
  keys.sort();
  return keys.map(k => k + '=' + encodeURIComponent(params[k])).join('&');
}

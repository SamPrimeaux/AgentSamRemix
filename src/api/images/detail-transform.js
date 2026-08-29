/** Images API: detail resolution, previews, and transform commit. */

import { jsonResponse } from '../../core/responses.js';
import { getR2Binding, listR2BucketsForCatalog, listBoundR2BucketNames, listR2ObjectsForCatalog } from '../r2-api.js';
import {
  assertDashboardR2BucketAccess,
  applyWorkspaceR2Transport,
} from '../../core/r2-storage-scope.js';
import { mergeR2S3EnvFromUserStorage } from '../../core/user-storage-r2-credentials.js';
import { r2PutViaBindingOrS3, r2HeadViaBindingOrS3 } from '../../core/r2.js';
import { getOAuthToken } from '../../../backend/identity/oauth/user-token.js';
import { canAccessMediaObjectKey } from '../../core/media-r2-access.js';
import { rateImageGeneration, runImageGenerationForTool } from '../../../backend/agentsam/tools/image_generation.js';
import {
  saveImageDraft,
  setImageProject,
  discardImageDraft,
  imageGenerationShouldPersist,
  IMAGE_SAVE_CATEGORY_PRESETS,
} from '../../core/image-draft-store.js';
import {
  enrichItemsFromR2CustomMetadata,
  normalizeTags,
  parseIamMetaFromStorage,
  putR2ImageWithCustomMetadata,
  syncR2ObjectCustomMetadata,
} from '../../core/r2-image-metadata.js';
import {
  getResourceTags,
  listAccountTagKeys,
  listValuesForKey,
  mergeResourceTag,
  removeResourceTag,
  syncImageResourceTags,
} from '../../core/cf-resource-tags.js';
import {
  ALLOWED_TRANSFORM_OPS,
  LimitExceededError,
  TransformValidationError,
  applyBindingPipeline,
  assertTransformableMime,
  assertWithinBindingInputLimit,
  assertWithinHostedUploadLimit,
  batchDeleteFromCfImages,
  batchPatchCfImageMeta,
  batchUploadToCfImages,
  buildFlexibleDeliveryUrl,
  createCfImageVariant,
  listCfImageVariants,
  runCfImagesBatch,
} from '../../core/cf-images-transform.js';
import {
  BUCKET,
  decodeR2BrowseId,
  encodeR2BrowseId,
  extFromMime,
  mediaIdToKey,
  mimeFromKey,
  safeFilename,
} from './ids.js';
import {
  buildCfImagesMetaPayload,
  buildMetaFromRow,
  buildR2SidecarPayload,
  iamTagsToResourceTagsMap,
  metaSidecarKey,
  parseMetadata,
  parseTags,
  resourceTagsMapToIamTags,
  sanitizeResourceTagsMap,
} from './meta.js';
import {
  cfDeliveryUrl,
  mapCfApiImage,
  mapD1RowToItem,
  mapDriveFile,
  mapR2BrowseObject,
  proxyR2Url,
} from './map.js';
import { resolveScope } from './scope.js';

import { deleteCfImage, insertImageRow, uploadToCfImages } from './storage.js';
import { getImageRowForPatch, registerCfImageToD1 } from './cf.js';
import { parseOpsFromQuery, safeJsonParse } from './patch.js';

const MAX_BYTES = 15 * 1024 * 1024;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
/** CF Images hosted upload (non-Enterprise). AVIF input is Enterprise-only — treat as unsupported here. */
const CF_IMAGES_INPUT_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/heic',
  'image/heif',
]);
const CF_IMAGES_INPUT_LABEL = 'JPEG, PNG, WebP, GIF, HEIC, or SVG';

export async function resolveImageSourceForBinding(env, row, accountHash) {
  if (row.r2_key) {
    const binding = getR2Binding(env, BUCKET);
    const obj = await binding?.get?.(row.r2_key).catch(() => null);
    if (!obj?.body) return { error: 'Source object not found in R2', status: 404 };
    return {
      stream: obj.body,
      byteLength: obj.size || 0,
      mime: obj.httpMetadata?.contentType || row.mime_type || 'image/jpeg',
    };
  }
  if (row.cloudflare_image_id) {
    const hash = accountHash || String(env.CLOUDFLARE_IMAGES_ACCOUNT_HASH || '').trim();
    const srcUrl = cfDeliveryUrl(hash, row.cloudflare_image_id, 'public');
    if (!srcUrl) return { error: 'No delivery URL available for source image', status: 502 };
    const res = await fetch(srcUrl);
    if (!res.ok || !res.body) return { error: 'Failed to fetch hosted source image', status: 502 };
    const len = Number(res.headers.get('content-length')) || 0;
    return {
      stream: res.body,
      byteLength: len,
      mime: res.headers.get('content-type') || row.mime_type || 'image/jpeg',
    };
  }
  return { error: 'Image has no R2 or Cloudflare Images source', status: 400 };
}

export async function resolveR2BrowseDetail(env, authUser, { bucket, key, origin, userId, workspaceId, accountHash }) {
  const access = await assertDashboardR2BucketAccess(env, authUser, bucket);
  if (!access.ok) {
    return {
      error: access.user_message || access.error || 'Forbidden',
      status: access.status || 403,
    };
  }
  const bucketName = access.bucket;
  const objectKey = String(key || '').replace(/^\/+/, '');
  if (!objectKey) return { error: 'Not found', status: 404 };

  if (bucketName === BUCKET && !(await canAccessMediaObjectKey(env, authUser, objectKey))) {
    return { error: 'Forbidden', status: 403 };
  }

  let listEnv = await mergeR2S3EnvFromUserStorage(env, authUser);
  listEnv = applyWorkspaceR2Transport(listEnv, env, access);
  const binding = getR2Binding(env, bucketName);

  let size = 0;
  let contentType = mimeFromKey(objectKey);
  let lastModified = null;
  let iam = null;

  if (binding?.head) {
    const obj = await binding.head(objectKey).catch(() => null);
    if (!obj) return { error: 'Not found', status: 404 };
    size = Number(obj.size) || 0;
    contentType = obj.httpMetadata?.contentType || contentType;
    lastModified = obj.uploaded ? new Date(obj.uploaded).toISOString() : null;
    if (obj.customMetadata && typeof obj.customMetadata === 'object') {
      iam = parseIamMetaFromStorage(obj.customMetadata);
    }
  } else {
    const head = await r2HeadViaBindingOrS3(listEnv, null, bucketName, objectKey);
    if (!head) return { error: 'Not found', status: 404 };
    size = Number(head.size) || 0;
    contentType = head.contentType || contentType;
    lastModified = head.last_modified || null;
  }

  let sidecar = null;
  if (binding?.get) {
    const scObj = await binding.get(metaSidecarKey(objectKey)).catch(() => null);
    if (scObj) {
      const text = await scObj.text().catch(() => '');
      sidecar = safeJsonParse(text);
    }
  }

  const tags = normalizeTags(iam?.tags?.length ? iam.tags : sidecar?.tags || []);
  const resourceTags = sanitizeResourceTagsMap(
    sidecar?.resource_tags && typeof sidecar.resource_tags === 'object'
      ? sidecar.resource_tags
      : iamTagsToResourceTagsMap(tags),
  );
  const metaMerged = {
    label: iam?.meta?.label || objectKey.split('/').pop() || objectKey,
    ...(iam?.meta || {}),
    ...(sidecar?.meta && typeof sidecar.meta === 'object' ? sidecar.meta : {}),
  };

  const id = encodeR2BrowseId(bucketName, objectKey);
  const url = proxyR2Url(origin, objectKey, bucketName);
  const keyName = objectKey.split('/').pop() || objectKey;
  const filename = String(metaMerged.label || keyName).trim() || keyName;
  const item = {
    id,
    source: 'r2',
    filename,
    url,
    thumbnail_url: url,
    mime_type: contentType,
    size,
    width: null,
    height: null,
    created_at: lastModified || new Date().toISOString(),
    user_id: userId,
    workspace_id: workspaceId || null,
    r2_key: objectKey,
    r2_bucket: bucketName,
    cloudflare_image_id: null,
    alt_text: iam?.alt_text || sidecar?.alt_text || null,
    description: iam?.description || sidecar?.description || null,
    tags,
    resource_tags: resourceTags,
    meta: {
      label: metaMerged.label || keyName,
      ...metaMerged,
    },
    visibility: 'private',
    _r2_browse_only: true,
    browse_only: true,
  };

  return {
    ok: true,
    item,
    image: item,
    resource_tags: resourceTags,
    variants: {},
    browse_only: true,
    source: 'r2',
    accountHash: accountHash || null,
    parent_image_id: null,
    transform_json: null,
    derivatives: [],
    capabilities: { cf_images: false, r2: true },
  };
}

export async function handleGetImageDetail(url, env, authUser, identity, imageId) {
  const scope = await resolveScope(
    env,
    authUser,
    identity,
    url.searchParams.get('workspace_id')?.trim(),
  );
  if (scope.error) return jsonResponse({ error: scope.error }, scope.status);

  const accountHash = String(env.CLOUDFLARE_IMAGES_ACCOUNT_HASH || '').trim();
  const origin = url.origin;
  const id = String(imageId || '').trim();

  // Drive browse-only detail — never requires a D1 images row.
  if (id.startsWith('drive_')) {
    const fileId = id.slice('drive_'.length);
    if (!fileId) return jsonResponse({ error: 'Not found' }, 404);
    const token = await getOAuthToken(env, scope.userId, 'google_drive');
    if (!token) return jsonResponse({ error: 'Google Drive not connected' }, 400);
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,createdTime,thumbnailLink,webViewLink,webContentLink`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const meta = await metaRes.json().catch(() => ({}));
    if (!metaRes.ok) {
      return jsonResponse({ error: meta.error?.message || 'Not found' }, metaRes.status === 404 ? 404 : 502);
    }
    const item = mapDriveFile(meta, scope.userId, origin);
    return jsonResponse({
      ok: true,
      item,
      image: item,
      variants: {},
      browse_only: true,
      source: 'drive',
      accountHash,
      parent_image_id: null,
      transform_json: null,
      derivatives: [],
      capabilities: { cf_images: false, drive: true },
    });
  }

  // R2 browse-only detail — R2 is source of truth; never INSERT into images.
  {
    const decoded = decodeR2BrowseId(id);
    const qsBucket = url.searchParams.get('r2_bucket')?.trim() || '';
    const qsKey = url.searchParams.get('r2_key')?.trim() || '';
    let bucket = decoded?.bucket || qsBucket;
    let key = decoded?.key || qsKey || '';
    if (!key && !decoded && qsBucket) {
      // Legacy grid links used base64url(key) as id + ?r2_bucket=
      const legacyKey = mediaIdToKey(id);
      if (legacyKey) key = legacyKey;
    }
    if (bucket && key) {
      const r2Detail = await resolveR2BrowseDetail(env, authUser, {
        bucket,
        key,
        origin,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        accountHash,
      });
      if (r2Detail.error) {
        return jsonResponse({ error: r2Detail.error }, r2Detail.status || 404);
      }
      return jsonResponse(r2Detail);
    }
  }

  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);

  // CF live list ids — prefer existing D1 by cloudflare_image_id; else synthetic delivery URLs (no fake r2_key).
  if (id.startsWith('cf_live_')) {
    const cfId = id.slice('cf_live_'.length);
    let row = await env.DB.prepare(
      `SELECT * FROM images
       WHERE cloudflare_image_id = ? AND user_id = ?
         AND COALESCE(status, 'active') = 'active'
       ORDER BY updated_at DESC LIMIT 1`,
    )
      .bind(cfId, scope.userId)
      .first()
      .catch(() => null);

    if (!row) {
      row = await registerCfImageToD1(env, scope, authUser, cfId, origin);
    }
    if (!row) return jsonResponse({ error: 'Not found' }, 404);

    const item = row._synthetic
      ? {
          ...mapCfApiImage(
            { id: cfId, metadata: {}, size: row.size, width: row.width, height: row.height, uploaded: row.created_at },
            accountHash,
            scope.userId,
          ),
          filename: row.filename,
          url: row.url || cfDeliveryUrl(accountHash, cfId, 'public'),
          thumbnail_url: row.thumbnail_url || cfDeliveryUrl(accountHash, cfId, 'thumbnail'),
          cloudflare_image_id: cfId,
          r2_key: null,
        }
      : mapD1RowToItem(row, { origin, accountHash });

    // Always expose real CF delivery URLs for hosted images.
    if (accountHash && cfId) {
      item.url = cfDeliveryUrl(accountHash, cfId, 'public') || item.url;
      item.thumbnail_url = cfDeliveryUrl(accountHash, cfId, 'thumbnail') || item.thumbnail_url;
      item.cloudflare_image_id = cfId;
      item.r2_key = row.r2_key || null;
      item.source = 'cf_images';
    }

    const variants = {};
    if (cfId && accountHash) {
      for (const v of ['public', 'thumbnail', 'small', 'medium', 'large', 'hero', 'avatar']) {
        variants[v] = cfDeliveryUrl(accountHash, cfId, v);
      }
    }

    let derivatives = [];
    if (!row._synthetic) {
      try {
        const { results } = await env.DB.prepare(
          `SELECT id, filename, thumbnail_url, url, created_at FROM images
           WHERE parent_image_id = ? AND COALESCE(status, 'active') = 'active'
           ORDER BY created_at DESC LIMIT 50`,
        )
          .bind(row.id)
          .all();
        derivatives = results || [];
      } catch {
        derivatives = [];
      }
    }

    const { resolveCfImagesUploadContext } = await import('../../core/cf-oauth-images.js');
    const cfCtx = await resolveCfImagesUploadContext(env, {
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    }).catch(() => null);

    return jsonResponse({
      ok: true,
      item,
      image: item,
      variants,
      accountHash,
      parent_image_id: row.parent_image_id || null,
      transform_json: row.transform_json ? safeJsonParse(row.transform_json) : null,
      derivatives,
      capabilities: { cf_images: !!(cfCtx && cfCtx.ok), source: cfCtx?.source || null },
    });
  }

  const rowOrErr = await getImageRowForPatch(env, id, scope, authUser, origin);
  if (!rowOrErr) return jsonResponse({ error: 'Not found' }, 404);
  if (rowOrErr.forbidden) return jsonResponse({ error: 'Forbidden' }, 403);
  const row = rowOrErr;

  const item = mapD1RowToItem(row, { origin, accountHash });
  if (row.cloudflare_image_id && accountHash) {
    item.url = cfDeliveryUrl(accountHash, row.cloudflare_image_id, 'public') || item.url;
    item.thumbnail_url =
      cfDeliveryUrl(accountHash, row.cloudflare_image_id, 'thumbnail') || item.thumbnail_url;
  }

  const variants = {};
  if (row.cloudflare_image_id) {
    for (const v of ['public', 'thumbnail', 'small', 'medium', 'large', 'hero', 'avatar']) {
      variants[v] = cfDeliveryUrl(accountHash, row.cloudflare_image_id, v);
    }
  }

  let derivatives = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, filename, thumbnail_url, url, created_at FROM images
       WHERE parent_image_id = ? AND COALESCE(status, 'active') = 'active'
       ORDER BY created_at DESC LIMIT 50`,
    )
      .bind(row.id)
      .all();
    derivatives = results || [];
  } catch {
    derivatives = [];
  }

  const { resolveCfImagesUploadContext } = await import('../../core/cf-oauth-images.js');
  const cfCtx = await resolveCfImagesUploadContext(env, {
    userId: scope.userId,
    workspaceId: scope.workspaceId,
  }).catch(() => null);

  let resourceTags = null;
  const cfIdForTags = String(row.cloudflare_image_id || '').trim();
  if (cfIdForTags) {
    const tagRes = await getResourceTags(env, cfIdForTags).catch(() => null);
    if (tagRes?.ok) {
      resourceTags = tagRes.tags || {};
      item.resource_tags = resourceTags;
    } else {
      const cached = parseMetadata(row.metadata)?.cf_resource_tags;
      if (cached && typeof cached === 'object') {
        resourceTags = cached;
        item.resource_tags = cached;
      }
    }
  }

  return jsonResponse({
    ok: true,
    item,
    image: item,
    variants,
    accountHash,
    parent_image_id: row.parent_image_id || null,
    transform_json: row.transform_json ? safeJsonParse(row.transform_json) : null,
    derivatives,
    resource_tags: resourceTags,
    capabilities: { cf_images: !!(cfCtx && cfCtx.ok), source: cfCtx?.source || null },
  });
}

/**
 * GET /api/images/:id/preview-url — allowlisted, clamped transform ops, streamed via the Images
 * binding (bytes in, bytes out — see QC-18 note). `mode=delivery` returns a cheap flexible-variant
 * delivery URL (JSON) instead of streaming bytes, for hosted images only.
 */
export async function handlePreviewUrl(url, env, authUser, identity, imageId) {
  const scope = await resolveScope(
    env,
    authUser,
    identity,
    url.searchParams.get('workspace_id')?.trim(),
  );
  if (scope.error) return jsonResponse({ error: scope.error }, scope.status);
  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);

  const rowOrErr = await getImageRowForPatch(env, imageId, scope, authUser, url.origin);
  if (!rowOrErr) return jsonResponse({ error: 'Not found' }, 404);
  if (rowOrErr.forbidden) return jsonResponse({ error: 'Forbidden' }, 403);
  const row = rowOrErr;

  try {
    assertTransformableMime(row.mime_type);
  } catch (e) {
    return jsonResponse({ error: e.message }, 400);
  }

  const accountHash = String(env.CLOUDFLARE_IMAGES_ACCOUNT_HASH || '').trim();
  const rawOps = parseOpsFromQuery(url.searchParams);

  if (url.searchParams.get('mode') === 'delivery' && row.cloudflare_image_id) {
    const deliveryUrl = buildFlexibleDeliveryUrl(accountHash, row.cloudflare_image_id, rawOps);
    return jsonResponse({ ok: true, preview_url: deliveryUrl, mode: 'delivery' });
  }

  const source = await resolveImageSourceForBinding(env, row, accountHash);
  if (source.error) return jsonResponse({ error: source.error }, source.status || 502);

  try {
    assertWithinBindingInputLimit(source.byteLength || 0);
  } catch (e) {
    return jsonResponse({ error: e.message }, 413);
  }

  const watermark = ['1', 'true'].includes(url.searchParams.get('watermark') || '');

  let pipelineResult;
  try {
    pipelineResult = await applyBindingPipeline(env, source.stream, rawOps, {
      watermark,
      defaultFormat: 'webp',
      baseWidth: row.width || undefined,
    });
  } catch (e) {
    if (e instanceof LimitExceededError) return jsonResponse({ error: e.message }, 413);
    if (e instanceof TransformValidationError) {
      return jsonResponse({ error: e.message, details: e.details }, 400);
    }
    return jsonResponse({ error: e?.message || 'transform failed' }, 502);
  }

  const resp = pipelineResult.output.response();
  const headers = new Headers(resp.headers);
  headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=300');
  headers.set('X-IAM-Transform-Ops', JSON.stringify(pipelineResult.ops));
  if (pipelineResult.dropped.length) headers.set('X-IAM-Transform-Dropped', pipelineResult.dropped.join(','));
  return new Response(resp.body, { status: resp.status, headers });
}

/**
 * POST /api/images/:id/transform — commit an allowlisted transform via the Images binding.
 * Default `mode: "derivative"` inserts a new library row (parent_image_id, transform_json).
 * `mode: "replace"` must be explicit and overwrites the existing row's hosted image in place.
 */
export async function handleTransformCommit(request, url, env, authUser, identity, imageId) {
  const scope = await resolveScope(
    env,
    authUser,
    identity,
    url.searchParams.get('workspace_id')?.trim(),
  );
  if (scope.error) return jsonResponse({ error: scope.error }, scope.status);
  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);

  const body = await request.json().catch(() => ({}));
  const rawOps = body.ops && typeof body.ops === 'object' ? body.ops : {};
  const mode = body.mode === 'replace' ? 'replace' : 'derivative';
  const watermark = body.watermark === true;

  const rowOrErr = await getImageRowForPatch(env, imageId, scope, authUser, url.origin);
  if (!rowOrErr) return jsonResponse({ error: 'Not found' }, 404);
  if (rowOrErr.forbidden) return jsonResponse({ error: 'Forbidden' }, 403);
  const row = rowOrErr;

  try {
    assertTransformableMime(row.mime_type);
  } catch (e) {
    return jsonResponse({ error: e.message }, 400);
  }

  const accountHash = String(env.CLOUDFLARE_IMAGES_ACCOUNT_HASH || '').trim();
  const source = await resolveImageSourceForBinding(env, row, accountHash);
  if (source.error) return jsonResponse({ error: source.error }, source.status || 502);

  try {
    assertWithinBindingInputLimit(source.byteLength || 0);
  } catch (e) {
    return jsonResponse({ error: e.message }, 413);
  }

  let pipelineResult;
  try {
    pipelineResult = await applyBindingPipeline(env, source.stream, rawOps, {
      watermark,
      defaultFormat: 'webp',
      baseWidth: row.width || undefined,
    });
  } catch (e) {
    if (e instanceof LimitExceededError) return jsonResponse({ error: e.message }, 413);
    if (e instanceof TransformValidationError) {
      return jsonResponse({ error: e.message, details: e.details }, 400);
    }
    return jsonResponse({ error: e?.message || 'transform failed' }, 502);
  }

  const outBuf = await pipelineResult.output.response().arrayBuffer();
  try {
    assertWithinHostedUploadLimit(outBuf.byteLength);
  } catch (e) {
    return jsonResponse({ error: e.message }, 413);
  }

  const { resolveCfImagesUploadContext } = await import('../../core/cf-oauth-images.js');
  const cfCtx = await resolveCfImagesUploadContext(env, {
    userId: scope.userId,
    workspaceId: scope.workspaceId,
  });
  if (!cfCtx.ok) {
    return jsonResponse({ error: cfCtx.error, detail: cfCtx.detail, accounts: cfCtx.accounts }, 403);
  }

  const ext = pipelineResult.format === 'jpeg' ? 'jpg' : pipelineResult.format;
  const baseName = String(row.filename || row.original_filename || 'image').replace(/\.[^.]+$/, '');
  const outFilename = safeFilename(`${baseName}-edit-${Date.now()}.${ext}`);
  const outMime = `image/${pipelineResult.format}`;
  const outFile = new File([outBuf], outFilename, { type: outMime });

  const transformMeta = {
    label: outFilename,
    category: '',
    project_slug: '',
    notes: mode === 'replace' ? 'replace edit' : 'derivative edit',
    tenant_slug: '',
    is_live: false,
    preferred_bg: '',
  };
  const cfMetaPayload = buildCfImagesMetaPayload({
    tags: parseTags(row.tags),
    meta: transformMeta,
    scope,
    alt_text: row.alt_text,
    filename: outFilename,
  });
  cfMetaPayload.iam_parent_image_id = String(mode === 'derivative' ? row.id : row.parent_image_id || row.id).slice(0, 64);

  const cf = await uploadToCfImages(env, outFile, cfMetaPayload, {
    accountId: cfCtx.accountId,
    token: cfCtx.token,
    iam_hosted: cfCtx.iam_hosted,
  });
  if (cf.error) return jsonResponse({ error: cf.error }, cf.status || 502);

  const newAccountHash = String(cfCtx.accountHash || accountHash || '').trim();
  const publicUrl = newAccountHash ? cfDeliveryUrl(newAccountHash, cf.imageId, 'public') : '';
  const thumbUrl = newAccountHash ? cfDeliveryUrl(newAccountHash, cf.imageId, 'thumbnail') : publicUrl;
  const transformJson = JSON.stringify({
    ops: pipelineResult.ops,
    dropped: pipelineResult.dropped,
    format: pipelineResult.format,
    watermark,
    mode,
    committed_at: new Date().toISOString(),
  });

  if (mode === 'replace') {
    if (row.cloudflare_image_id && row.cloudflare_image_id !== cf.imageId) {
      await deleteCfImage(env, row.cloudflare_image_id);
    }
    await env.DB.prepare(
      `UPDATE images SET cloudflare_image_id = ?, url = ?, thumbnail_url = ?, size = ?,
        mime_type = ?, transform_json = ?, updated_at = unixepoch() WHERE id = ?`,
    )
      .bind(cf.imageId, publicUrl, thumbUrl, outBuf.byteLength, outMime, transformJson, row.id)
      .run();

    const updated = await env.DB.prepare(`SELECT * FROM images WHERE id = ? LIMIT 1`).bind(row.id).first();
    const item = mapD1RowToItem(updated, { origin: url.origin, accountHash: newAccountHash });
    return jsonResponse({
      ok: true,
      mode,
      item,
      image: item,
      parent_image_id: updated.parent_image_id || null,
      transform_json: transformJson,
    });
  }

  const imageUuid = crypto.randomUUID();
  const rowId = `img_${imageUuid.replace(/-/g, '').slice(0, 24)}`;
  const newRow = await insertImageRow(env, {
    id: rowId,
    tenant_id: scope.tenantId,
    project_id: row.project_id || null,
    user_id: scope.userId,
    filename: outFilename,
    original_filename: row.original_filename || row.filename,
    mime_type: outMime,
    size: outBuf.byteLength,
    width: null,
    height: null,
    r2_key: null,
    cloudflare_image_id: cf.imageId,
    url: publicUrl,
    thumbnail_url: thumbUrl,
    alt_text: row.alt_text || null,
    description: row.description || null,
    tags: row.tags || '[]',
    metadata: JSON.stringify({
      ...transformMeta,
      registered_from: 'transform_derivative',
      iam_hosted: cfCtx.iam_hosted === true,
    }),
    workspace_id: scope.workspaceId,
    parent_image_id: row.id,
    transform_json: transformJson,
  });

  const item = mapD1RowToItem(newRow, { origin: url.origin, accountHash: newAccountHash });
  return jsonResponse({
    ok: true,
    mode,
    item,
    image: item,
    parent_image_id: newRow.parent_image_id,
    transform_json: newRow.transform_json,
  });
}

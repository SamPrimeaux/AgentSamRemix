/** Images API: list, upload, Drive import, and delete handlers. */

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

import {
  cfImagesUnsupportedPayload,
  deleteCfImage,
  insertImageRow,
  isCfImagesUnsupportedFormat,
  listAllCfImagesLive,
  listD1Images,
  listDriveImages,
  listR2BrowseImages,
  uploadToCfImages,
  writeR2MetaSidecar,
} from './storage.js';

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

export async function handleGetImages(request, url, env, authUser, identity) {
  const scope = await resolveScope(
    env,
    authUser,
    identity,
    url.searchParams.get('workspace_id')?.trim(),
  );
  if (scope.error) return jsonResponse({ error: scope.error }, scope.status);

  const source = (url.searchParams.get('source') || 'all').toLowerCase();
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(url.searchParams.get('per_page') || '50', 10) || 50));
  const tagFilter = (url.searchParams.get('tag') || '').trim().toLowerCase();
  const searchQ = (url.searchParams.get('q') || url.searchParams.get('search') || '').trim();
  const projectIdFilter = (url.searchParams.get('project_id') || '').trim();
  const projectSlugFilter = (url.searchParams.get('project_slug') || '').trim().toLowerCase();
  const categoryFilter = (url.searchParams.get('category') || '').trim().toLowerCase();
  const accountHash = String(env.CLOUDFLARE_IMAGES_ACCOUNT_HASH || '').trim();
  const origin = url.origin;

  const matchesFilters = (item) => {
    if (tagFilter) {
      const tags = (item.tags || []).map((t) => String(t).toLowerCase());
      if (!tags.includes(tagFilter)) return false;
    }
    if (projectIdFilter) {
      if (String(item.project_id || '') !== projectIdFilter) return false;
    }
    if (projectSlugFilter) {
      const slug = String(item.meta?.project_slug || '').trim().toLowerCase();
      if (slug !== projectSlugFilter) return false;
    }
    if (categoryFilter) {
      const cat = String(item.meta?.category || '').toLowerCase();
      const tags = (item.tags || []).map((t) => String(t).toLowerCase());
      if (cat !== categoryFilter && !tags.includes(categoryFilter)) return false;
    }
    if (searchQ) {
      const q = searchQ.toLowerCase();
      const hay = [
        item.filename,
        item.id,
        item.r2_key,
        item.alt_text,
        item.description,
        item.meta?.label,
        item.meta?.notes,
        item.meta?.category,
        item.meta?.project_slug,
        item.meta?.size_label,
        ...(item.tags || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };

  if (source === 'drive') {
    const drive = await listDriveImages(env, scope.userId, origin);
    const total = drive.items.length;
    const start = (page - 1) * perPage;
    const items = drive.items.slice(start, start + perPage);
    return jsonResponse({
      items,
      images: items,
      total,
      page,
      per_page: perPage,
      drive_connected: drive.connected,
      drive_error: drive.error || null,
      drive_account_email: drive.account_email || null,
      drive_expires_at: drive.expires_at ?? null,
      drive_has_refresh: drive.has_refresh ?? null,
      /** Browse-only: list/preview never writes R2/CF/D1. Copy only via POST /import/drive. */
      drive_browse_only: true,
      accountHash,
    });
  }

  const r2BucketParam = url.searchParams.get('r2_bucket')?.trim() || '';
  const r2PrefixParam = url.searchParams.get('r2_prefix') ?? '';
  const r2RegistryOnly = url.searchParams.get('r2_mode') === 'registry';

  let r2BucketsCatalog = null;
  if (source === 'r2') {
    try {
      r2BucketsCatalog = await listR2BucketsForCatalog(env, {
        authUser,
        workspaceId: scope.workspaceId,
      });
    } catch {
      r2BucketsCatalog = { buckets: [], bound: [], count: 0 };
    }

    if (!r2BucketParam) {
      return jsonResponse({
        items: [],
        images: [],
        total: 0,
        page,
        per_page: perPage,
        accountHash,
        workspace_id: scope.workspaceId,
        r2_buckets: r2BucketsCatalog?.buckets || [],
        r2_selection_required: true,
      });
    }
  }

  if (source === 'r2' && r2BucketParam && !r2RegistryOnly) {
    const browse = await listR2BrowseImages(env, authUser, {
      bucket: r2BucketParam,
      prefix: r2PrefixParam,
      origin,
      workspaceId: scope.workspaceId,
    });
    if (browse.error) {
      return jsonResponse(
        {
          error: browse.error,
          r2_buckets: r2BucketsCatalog?.buckets || [],
          r2_bucket: r2BucketParam,
          r2_prefix: r2PrefixParam,
        },
        browse.status || 400,
      );
    }

    const r2Binding = getR2Binding(env, browse.bucket || r2BucketParam);
    let items = browse.items || [];
    if (r2Binding) {
      items = await enrichItemsFromR2CustomMetadata(r2Binding, items);
    }
    const filtered = items.filter(matchesFilters);
    const total = filtered.length;
    const start = (page - 1) * perPage;
    const pageItems = filtered.slice(start, start + perPage);

    return jsonResponse({
      items: pageItems,
      images: pageItems,
      total,
      page,
      per_page: perPage,
      accountHash,
      workspace_id: scope.workspaceId,
      r2_buckets: r2BucketsCatalog?.buckets || [],
      r2_bucket: browse.bucket || r2BucketParam,
      r2_prefix: browse.prefix ?? r2PrefixParam,
      r2_browse: true,
    });
  }

  const merged = [];
  const knownCf = new Set();

  if (source === 'all' || source === 'r2' || source === 'cf_images') {
    const d1Rows = await listD1Images(env, {
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      source: source === 'all' ? null : source,
      tag: tagFilter || null,
      search: null,
      projectId: projectIdFilter || null,
      category: categoryFilter || null,
      limit: 5000,
      offset: 0,
    });
    for (const row of d1Rows) {
      if (row.cloudflare_image_id) knownCf.add(row.cloudflare_image_id);
      merged.push(mapD1RowToItem(row, { origin, accountHash }));
    }
  }

  if ((source === 'all' || source === 'cf_images') && env.CLOUDFLARE_IMAGES_TOKEN) {
    const live = await listAllCfImagesLive(env, scope.userId, knownCf);
    merged.push(...live.items);
  }

  merged.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  const r2Binding = getR2Binding(env, BUCKET);
  const enriched = await enrichItemsFromR2CustomMetadata(r2Binding, merged);

  const filtered = enriched.filter(matchesFilters);
  const total = filtered.length;
  const start = (page - 1) * perPage;
  const items = filtered.slice(start, start + perPage);

  return jsonResponse({
    items,
    images: items,
    total,
    page,
    per_page: perPage,
    accountHash,
    workspace_id: scope.workspaceId,
    ...(source === 'r2' && r2BucketsCatalog
      ? {
          r2_buckets: r2BucketsCatalog.buckets || [],
          r2_bucket: r2BucketParam,
          r2_prefix: r2PrefixParam,
          r2_browse: false,
        }
      : {}),
  });
}

export async function handleUpload(request, url, env, authUser, identity) {
  const scope = await resolveScope(
    env,
    authUser,
    identity,
    url.searchParams.get('workspace_id')?.trim(),
  );
  if (scope.error) return jsonResponse({ error: scope.error }, scope.status);
  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);

  const destRaw = (url.searchParams.get('destination') || '').trim().toLowerCase();
  let forceR2 =
    destRaw === 'r2' ||
    url.searchParams.get('force_r2') === '1' ||
    url.searchParams.get('force_r2') === 'true';
  let targetBucket = (url.searchParams.get('r2_bucket') || '').trim() || BUCKET;

  const platformBinding = getR2Binding(env, BUCKET);
  if (!forceR2 && !platformBinding?.put) {
    return jsonResponse({ error: 'R2 not configured' }, 503);
  }

  const ct = (request.headers.get('Content-Type') || '').toLowerCase();
  let buf;
  let mime;
  let originalName;
  let altText = '';
  let tagsJson = '[]';

  if (ct.includes('application/json')) {
    const body = await request.json().catch(() => ({}));
    altText = String(body.alt_text || '').trim();
    tagsJson = JSON.stringify(Array.isArray(body.tags) ? body.tags : []);
    if (body.destination === 'r2' || body.force_r2 === true || body.force_r2 === 1) forceR2 = true;
    if (body.r2_bucket) targetBucket = String(body.r2_bucket).trim() || targetBucket;
    const srcUrl = String(body.url || '').trim();
    if (!srcUrl) return jsonResponse({ error: 'url required' }, 400);
    let res;
    try {
      res = await fetch(srcUrl, {
        redirect: 'follow',
        headers: { 'User-Agent': 'InnerAnimalMedia-ImagesImport/1.0' },
      });
    } catch (e) {
      return jsonResponse({ error: `fetch failed: ${e?.message || e}` }, 400);
    }
    if (!res.ok) return jsonResponse({ error: `upstream ${res.status}` }, 400);
    buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return jsonResponse({ error: 'image too large (max 15MB)' }, 400);
    mime = (res.headers.get('Content-Type') || 'image/jpeg').split(';')[0].trim();
    if (!mime.startsWith('image/')) return jsonResponse({ error: 'URL did not return an image' }, 400);
    originalName = safeFilename(srcUrl.split('/').pop() || 'import.jpg');
  } else {
    const fd = await request.formData().catch(() => null);
    const file = fd?.get('file');
    if (!file || typeof file === 'string') return jsonResponse({ error: 'file required' }, 400);
    altText = String(fd?.get('alt_text') || '').trim();
    const destField = String(fd?.get('destination') || '').trim().toLowerCase();
    if (destField === 'r2' || String(fd?.get('force_r2') || '') === '1') forceR2 = true;
    const bucketField = String(fd?.get('r2_bucket') || '').trim();
    if (bucketField) targetBucket = bucketField;
    const tagsRaw = fd?.get('tags');
    if (tagsRaw && typeof tagsRaw === 'string') {
      try {
        tagsJson = JSON.stringify(JSON.parse(tagsRaw));
      } catch {
        tagsJson = JSON.stringify(
          tagsRaw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        );
      }
    }
    buf = await file.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return jsonResponse({ error: 'file too large (max 15MB)' }, 400);
    mime = (file.type || 'image/jpeg').split(';')[0].trim();
    originalName = safeFilename(('name' in file && file.name) || 'upload.jpg');
  }

  // Pre-flight: formats CF Images rejects → offer R2 instead of a dead-end toast.
  if (!forceR2 && isCfImagesUnsupportedFormat(mime, '')) {
    return jsonResponse(cfImagesUnsupportedPayload(mime, null), 415);
  }

  const ext = extFromMime(mime);
  const imageUuid = crypto.randomUUID();
  const r2Key = `images/${scope.workspaceId}/${scope.userId}/${imageUuid}.${ext}`;
  const filename = originalName || `${imageUuid}.${ext}`;
  const uploadTags = normalizeTags(parseTags(tagsJson));
  const iamMeta = {
    label: filename,
    category: '',
    project_slug: '',
    notes: '',
    tenant_slug: '',
    is_live: false,
    preferred_bg: '',
  };

  /** Persist R2-only (or CF-rejected fallback) into selected bucket + D1 registry. */
  async function persistR2Only(reason) {
    const access = await assertDashboardR2BucketAccess(env, authUser, targetBucket);
    if (!access.ok) {
      return jsonResponse(
        {
          error: access.user_message || access.error || 'R2 bucket not allowed',
          code: 'r2_bucket_denied',
          fallback: 'r2',
        },
        access.status || 403,
      );
    }
    let putEnv = await mergeR2S3EnvFromUserStorage(env, authUser);
    putEnv = applyWorkspaceR2Transport(putEnv, env, access);
    const binding = getR2Binding(putEnv, access.bucket) || getR2Binding(env, access.bucket);
    const ok = await r2PutViaBindingOrS3(putEnv, binding, access.bucket, r2Key, buf, mime);
    if (!ok) {
      return jsonResponse(
        {
          error: `Failed to write to R2 bucket "${access.bucket}". Check Settings → Storage R2 keys.`,
          code: 'r2_put_failed',
        },
        502,
      );
    }

    const r2Tags = reason ? [...uploadTags, 'r2_only'] : [...uploadTags];
    const publicUrl = proxyR2Url(url.origin, r2Key, access.bucket);
    if (binding?.put) {
      try {
        const r2Sidecar = buildR2SidecarPayload({
          tags: r2Tags,
          meta: { ...iamMeta, r2_bucket: access.bucket },
          alt_text: altText,
          scope,
        });
        await writeR2MetaSidecar(binding, r2Key, r2Sidecar);
      } catch {
        /* metadata sidecar is best-effort */
      }
    }

    const rowId = `img_${imageUuid.replace(/-/g, '').slice(0, 24)}`;
    const row = await insertImageRow(env, {
      id: rowId,
      tenant_id: scope.tenantId,
      project_id: null,
      user_id: scope.userId,
      filename,
      original_filename: originalName,
      mime_type: mime,
      size: buf.byteLength,
      width: null,
      height: null,
      r2_key: r2Key,
      cloudflare_image_id: null,
      url: publicUrl,
      thumbnail_url: publicUrl,
      alt_text: altText || null,
      description: null,
      tags: JSON.stringify(r2Tags),
      metadata: JSON.stringify({
        ...iamMeta,
        registered_from: reason || 'upload_r2',
        r2_bucket: access.bucket,
        cf_skipped: true,
      }),
      workspace_id: scope.workspaceId,
    });

    const item = mapD1RowToItem(row, { origin: url.origin, accountHash: '' });
    return jsonResponse({
      ok: true,
      item,
      image: item,
      destination: 'r2',
      r2_bucket: access.bucket,
      ...(reason ? { cf_fallback: true, cf_error: reason } : {}),
    });
  }

  if (forceR2) {
    return persistR2Only('destination_r2');
  }

  const cfMetaPayload = buildCfImagesMetaPayload({
    tags: uploadTags,
    meta: iamMeta,
    scope,
    alt_text: altText,
    filename,
  });

  const fileBlob = new File([buf], filename, { type: mime });
  const { resolveCfImagesUploadContext } = await import('../../core/cf-oauth-images.js');
  const cfCtx = await resolveCfImagesUploadContext(env, {
    userId: scope.userId,
    workspaceId: scope.workspaceId,
  });
  if (!cfCtx.ok) {
    return jsonResponse({ error: cfCtx.error, detail: cfCtx.detail, accounts: cfCtx.accounts }, 400);
  }
  const cf = await uploadToCfImages(env, fileBlob, cfMetaPayload, {
    accountId: cfCtx.accountId,
    token: cfCtx.token,
    iam_hosted: cfCtx.iam_hosted,
  });
  if (cf.error) {
    if (isCfImagesUnsupportedFormat(mime, cf.error)) {
      return jsonResponse(cfImagesUnsupportedPayload(mime, cf.error), cf.status || 415);
    }
    return jsonResponse({ error: cf.error }, cf.status || 502);
  }

  const r2Sidecar = buildR2SidecarPayload({
    tags: uploadTags,
    meta: iamMeta,
    alt_text: altText,
    scope,
  });
  if (platformBinding?.put) {
    await putR2ImageWithCustomMetadata(platformBinding, r2Key, buf, {
      contentType: mime,
      tags: uploadTags,
      meta: iamMeta,
      scope,
      alt_text: altText,
    });
    await writeR2MetaSidecar(platformBinding, r2Key, r2Sidecar);
  }

  const cfId = cf.imageId;
  const accountHash =
    String(cfCtx.accountHash || env.CLOUDFLARE_IMAGES_ACCOUNT_HASH || '').trim();
  const publicUrl = accountHash ? cfDeliveryUrl(accountHash, cfId, 'public') : '';
  const thumbUrl = accountHash ? cfDeliveryUrl(accountHash, cfId, 'thumbnail') : publicUrl;

  const rowId = `img_${imageUuid.replace(/-/g, '').slice(0, 24)}`;
  const row = await insertImageRow(env, {
    id: rowId,
    tenant_id: scope.tenantId,
    project_id: null,
    user_id: scope.userId,
    filename,
    original_filename: originalName,
    mime_type: mime,
    size: buf.byteLength,
    width: null,
    height: null,
    r2_key: r2Key,
    cloudflare_image_id: cfId,
    url: publicUrl,
    thumbnail_url: thumbUrl,
    alt_text: altText || null,
    description: null,
    tags: tagsJson,
    metadata: JSON.stringify({
      ...iamMeta,
      registered_from: 'upload',
      iam_hosted: cfCtx.iam_hosted === true,
      cf_account_id: cfCtx.accountId,
      cf_images_source: cfCtx.source,
      r2_bucket: BUCKET,
    }),
    workspace_id: scope.workspaceId,
  });

  const item = mapD1RowToItem(row, { origin: url.origin, accountHash });
  return jsonResponse({ ok: true, item, image: item });
}

export async function handleDriveImport(request, url, env, authUser, identity) {
  const scope = await resolveScope(
    env,
    authUser,
    identity,
    url.searchParams.get('workspace_id')?.trim(),
  );
  if (scope.error) return jsonResponse({ error: scope.error }, scope.status);

  const body = await request.json().catch(() => ({}));
  const driveFileId = String(body.drive_file_id || body.file_id || '').trim();
  if (!driveFileId) return jsonResponse({ error: 'drive_file_id required' }, 400);

  const token = await getOAuthToken(env, scope.userId, 'google_drive');
  if (!token) return jsonResponse({ error: 'Google Drive not connected' }, 400);

  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?fields=id,name,mimeType,size`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const meta = await metaRes.json().catch(() => ({}));
  if (!metaRes.ok) return jsonResponse({ error: meta.error?.message || 'Drive file not found' }, 404);

  const dlRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!dlRes.ok) return jsonResponse({ error: 'Drive download failed' }, 502);
  const buf = await dlRes.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return jsonResponse({ error: 'file too large (max 15MB)' }, 400);

  const mime = meta.mimeType || 'image/jpeg';
  const filename = safeFilename(meta.name || `drive-${driveFileId}.jpg`);
  const ext = extFromMime(mime);
  const imageUuid = crypto.randomUUID();
  const r2Key = `images/${scope.workspaceId}/${scope.userId}/${imageUuid}.${ext}`;

  const binding = getR2Binding(env, BUCKET);
  if (!binding?.put) return jsonResponse({ error: 'R2 not configured' }, 503);

  const driveTags = ['drive_import'];
  const driveMeta = {
    label: filename,
    category: '',
    project_slug: '',
    notes: '',
    tenant_slug: '',
    is_live: false,
    preferred_bg: '',
  };

  // Import to R2 = R2 + D1 only. Never auto-upload to Cloudflare Images.
  const publicUrl = proxyR2Url(url.origin, r2Key);
  const thumbUrl = publicUrl;
  const cfId = null;

  const r2Sidecar = buildR2SidecarPayload({
    tags: driveTags,
    meta: driveMeta,
    alt_text: null,
    scope,
  });
  await putR2ImageWithCustomMetadata(binding, r2Key, buf, {
    contentType: mime,
    tags: driveTags,
    meta: driveMeta,
    scope,
    alt_text: null,
    extra: { drive_file_id: driveFileId },
  });
  await writeR2MetaSidecar(binding, r2Key, r2Sidecar);

  const accountHash = String(env.CLOUDFLARE_IMAGES_ACCOUNT_HASH || '').trim();
  const rowId = `img_${imageUuid.replace(/-/g, '').slice(0, 24)}`;
  const row = await insertImageRow(env, {
    id: rowId,
    tenant_id: scope.tenantId,
    project_id: null,
    user_id: scope.userId,
    filename,
    original_filename: meta.name || filename,
    mime_type: mime,
    size: buf.byteLength,
    width: null,
    height: null,
    r2_key: r2Key,
    cloudflare_image_id: cfId,
    url: publicUrl,
    thumbnail_url: thumbUrl,
    alt_text: null,
    description: null,
    tags: JSON.stringify(driveTags),
    metadata: JSON.stringify({ ...driveMeta, drive_file_id: driveFileId }),
    workspace_id: scope.workspaceId,
  });

  const item = mapD1RowToItem(row, { origin: url.origin, accountHash });
  return jsonResponse({ ok: true, item, image: item, imported_to: 'r2_d1' });
}

export async function handleDelete(imageId, request, url, env, authUser, identity) {
  if (String(imageId).startsWith('drive_')) {
    return jsonResponse({ error: 'Drive items must be imported before delete' }, 400);
  }
  if (String(imageId).startsWith('cf_live_')) {
    const cfId = String(imageId).slice('cf_live_'.length);
    await deleteCfImage(env, cfId);
    return jsonResponse({ ok: true, deleted: cfId, source: 'cf_images' });
  }

  const legacyKey = mediaIdToKey(imageId);
  if (legacyKey) {
    const binding = getR2Binding(env, BUCKET);
    if (!(await canAccessMediaObjectKey(env, authUser, legacyKey))) {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }
    await binding?.delete?.(legacyKey).catch(() => {});
    await binding?.delete?.(metaSidecarKey(legacyKey)).catch(() => {});
    return jsonResponse({ ok: true, source: 'r2_legacy' });
  }

  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);
  const row = await env.DB.prepare(`SELECT * FROM images WHERE id = ? LIMIT 1`)
    .bind(imageId)
    .first();
  if (!row) return jsonResponse({ error: 'Not found' }, 404);
  if (String(row.user_id) !== String(authUser.id)) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  if (row.cloudflare_image_id) await deleteCfImage(env, row.cloudflare_image_id);
  const r2Key = String(row.r2_key || '').trim();
  if (r2Key && !r2Key.startsWith('__cf_hosted__/')) {
    const binding = getR2Binding(env, BUCKET);
    await binding?.delete?.(r2Key).catch(() => {});
    await binding?.delete?.(metaSidecarKey(r2Key)).catch(() => {});
  }

  await env.DB.prepare(
    `UPDATE images SET status = 'deleted', updated_at = unixepoch() WHERE id = ? AND user_id = ?`,
  )
    .bind(imageId, authUser.id)
    .run();

  return jsonResponse({ ok: true, id: imageId });
}

/** Images API: image patching and legacy metadata compatibility. */

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

import { syncImageStorageMeta, syncR2ImageMeta } from './storage.js';
import { getImageRowForPatch } from './cf.js';

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

export async function handlePatchR2BrowseImage(request, url, env, authUser, identity, imageId, payload) {
  const scope = await resolveScope(
    env,
    authUser,
    identity,
    url.searchParams.get('workspace_id')?.trim(),
  );
  if (scope.error) return jsonResponse({ error: scope.error }, scope.status);

  const decoded = decodeR2BrowseId(imageId);
  if (!decoded) return jsonResponse({ error: 'Not found' }, 404);

  const access = await assertDashboardR2BucketAccess(env, authUser, decoded.bucket);
  if (!access.ok) {
    return jsonResponse(
      { error: access.user_message || access.error || 'Forbidden' },
      access.status || 403,
    );
  }
  const bucketName = access.bucket;
  const objectKey = decoded.key;
  if (bucketName === BUCKET && !(await canAccessMediaObjectKey(env, authUser, objectKey))) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  let listEnv = await mergeR2S3EnvFromUserStorage(env, authUser);
  listEnv = applyWorkspaceR2Transport(listEnv, env, access);
  const binding = getR2Binding(env, bucketName);

  let size = 0;
  let contentType = mimeFromKey(objectKey);
  let lastModified = null;
  let iam = null;
  let sidecar = null;

  if (binding?.head) {
    const obj = await binding.head(objectKey).catch(() => null);
    if (!obj) return jsonResponse({ error: 'Not found' }, 404);
    size = Number(obj.size) || 0;
    contentType = obj.httpMetadata?.contentType || contentType;
    lastModified = obj.uploaded ? new Date(obj.uploaded).toISOString() : null;
    if (obj.customMetadata && typeof obj.customMetadata === 'object') {
      iam = parseIamMetaFromStorage(obj.customMetadata);
    }
  } else {
    const head = await r2HeadViaBindingOrS3(listEnv, null, bucketName, objectKey);
    if (!head) return jsonResponse({ error: 'Not found' }, 404);
    size = Number(head.size) || 0;
    contentType = head.contentType || contentType;
    lastModified = head.last_modified || null;
  }

  if (binding?.get) {
    const scObj = await binding.get(metaSidecarKey(objectKey)).catch(() => null);
    if (scObj) {
      const text = await scObj.text().catch(() => '');
      sidecar = safeJsonParse(text);
    }
  }

  const prevMeta = {
    label: iam?.meta?.label || objectKey.split('/').pop() || objectKey,
    ...(iam?.meta || {}),
    ...(sidecar?.meta && typeof sidecar.meta === 'object' ? sidecar.meta : {}),
  };
  const meta = { ...prevMeta };
  if (payload.label !== undefined) meta.label = String(payload.label || '').trim();
  if (payload.notes !== undefined) meta.notes = String(payload.notes || '').trim();
  if (payload.is_live !== undefined) meta.is_live = !!payload.is_live;
  if (payload.preferred_bg !== undefined) meta.preferred_bg = String(payload.preferred_bg || '').trim();
  if (payload.category !== undefined) meta.category = String(payload.category || '').trim();
  if (payload.project_slug !== undefined) meta.project_slug = String(payload.project_slug || '').trim();
  if (payload.tenant_slug !== undefined) meta.tenant_slug = String(payload.tenant_slug || '').trim();

  let resourceTags = sanitizeResourceTagsMap(
    payload.resource_tags !== undefined
      ? payload.resource_tags
      : sidecar?.resource_tags || iamTagsToResourceTagsMap(iam?.tags || sidecar?.tags || []),
  );
  if (payload.resource_tags !== undefined) {
    resourceTags = sanitizeResourceTagsMap(payload.resource_tags);
  }

  const tagList =
    payload.tags !== undefined
      ? normalizeTags(payload.tags)
      : payload.resource_tags !== undefined
        ? resourceTagsMapToIamTags(resourceTags)
        : normalizeTags(iam?.tags || sidecar?.tags || []);

  const alt =
    payload.alt_text !== undefined
      ? String(payload.alt_text || '').trim() || null
      : iam?.alt_text || sidecar?.alt_text || null;
  const description =
    payload.description !== undefined
      ? String(payload.description || '').trim() || null
      : iam?.description || sidecar?.description || null;

  const sidecarPayload = buildR2SidecarPayload({
    tags: tagList,
    meta,
    alt_text: alt,
    scope,
    resource_tags: resourceTags,
  });
  sidecarPayload.description = description;

  const storageSync = {
    r2: await syncR2ImageMeta(listEnv, objectKey, sidecarPayload, tagList, scope, size, bucketName),
    cf: null,
    cf_tags: {
      ok: false,
      skipped: true,
      reason:
        'Cloudflare Resource Tagging does not apply to R2 object keys — saved as IAM iam_tags + sidecar',
    },
  };

  const keyName = objectKey.split('/').pop() || objectKey;
  const filename = String(meta.label || keyName).trim() || keyName;
  const item = {
    id: encodeR2BrowseId(bucketName, objectKey),
    source: 'r2',
    filename,
    url: proxyR2Url(url.origin, objectKey, bucketName),
    thumbnail_url: proxyR2Url(url.origin, objectKey, bucketName),
    mime_type: contentType,
    size,
    width: null,
    height: null,
    created_at: lastModified || new Date().toISOString(),
    user_id: scope.userId,
    workspace_id: scope.workspaceId || null,
    r2_key: objectKey,
    r2_bucket: bucketName,
    cloudflare_image_id: null,
    alt_text: alt,
    description,
    tags: tagList,
    resource_tags: resourceTags,
    meta: { label: meta.label || keyName, ...meta },
    visibility: 'private',
    _r2_browse_only: true,
    browse_only: true,
  };

  return jsonResponse({
    ok: true,
    item,
    image: item,
    meta: item.meta,
    id: item.id,
    tags: tagList,
    resource_tags: resourceTags,
    browse_only: true,
    storage_sync: storageSync,
  });
}

export async function handlePatchImage(request, url, env, authUser, identity, imageId, payloadOverride) {
  const scope = await resolveScope(
    env,
    authUser,
    identity,
    url.searchParams.get('workspace_id')?.trim(),
  );
  if (scope.error) return jsonResponse({ error: scope.error }, scope.status);

  const payload = payloadOverride ?? (await request.json().catch(() => ({})));

  // R2 browse ids never have a D1 row — IAM tag path (not CF Resource Tagging).
  if (decodeR2BrowseId(imageId)) {
    return handlePatchR2BrowseImage(request, url, env, authUser, identity, imageId, payload);
  }

  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);

  const rowOrErr = await getImageRowForPatch(env, imageId, scope, authUser, url.origin);
  if (!rowOrErr) return jsonResponse({ error: 'Not found' }, 404);
  if (rowOrErr.forbidden) return jsonResponse({ error: 'Forbidden' }, 403);
  const row = rowOrErr;

  const meta = parseMetadata(row.metadata);
  const sets = [];
  const binds = [];

  if (payload.tags !== undefined) {
    sets.push('tags = ?');
    binds.push(JSON.stringify(normalizeTags(payload.tags)));
  }
  if (payload.label !== undefined) {
    meta.label = String(payload.label || '').trim();
  }
  if (payload.notes !== undefined) {
    meta.notes = String(payload.notes || '').trim();
  }
  if (payload.is_live !== undefined) {
    meta.is_live = !!payload.is_live;
  }
  if (payload.preferred_bg !== undefined) {
    meta.preferred_bg = String(payload.preferred_bg || '').trim();
  }
  if (payload.category !== undefined) {
    meta.category = String(payload.category || '').trim();
  }
  if (payload.project_slug !== undefined) {
    meta.project_slug = String(payload.project_slug || '').trim();
  }
  if (payload.tenant_slug !== undefined) {
    meta.tenant_slug = String(payload.tenant_slug || '').trim();
  }
  if (payload.resource_tags !== undefined) {
    meta.cf_resource_tags =
      payload.resource_tags && typeof payload.resource_tags === 'object' && !Array.isArray(payload.resource_tags)
        ? payload.resource_tags
        : {};
  }

  sets.push('metadata = ?');
  binds.push(JSON.stringify(meta));

  if (payload.alt_text !== undefined) {
    sets.push('alt_text = ?');
    binds.push(String(payload.alt_text || '').trim() || null);
  }
  if (payload.description !== undefined) {
    sets.push('description = ?');
    binds.push(String(payload.description || '').trim() || null);
  }
  if (payload.label !== undefined && String(payload.label || '').trim()) {
    sets.push('filename = ?');
    binds.push(String(payload.label).trim());
  }

  sets.push('updated_at = unixepoch()');
  binds.push(row.id);

  await env.DB.prepare(`UPDATE images SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  const updated = await env.DB.prepare(`SELECT * FROM images WHERE id = ? LIMIT 1`)
    .bind(row.id)
    .first();

  const mergedMeta = buildMetaFromRow(updated);
  const mergedTags = payload.tags !== undefined
    ? normalizeTags(payload.tags)
    : parseTags(updated.tags);
  const mergedAlt = payload.alt_text !== undefined
    ? String(payload.alt_text || '').trim() || null
    : updated.alt_text;

  const resourceTagsForSync =
    payload.resource_tags !== undefined
      ? meta.cf_resource_tags
      : mergedMeta.cf_resource_tags !== undefined
        ? undefined
        : undefined;

  const storageSync = await syncImageStorageMeta(env, updated, scope, {
    tags: mergedTags,
    meta: mergedMeta,
    alt_text: mergedAlt,
    resource_tags: payload.resource_tags !== undefined ? meta.cf_resource_tags : undefined,
  });

  // Incremental add/remove (GET→merge→PUT) when UI sends a single op instead of full replace.
  if (payload.resource_tag_op && updated.cloudflare_image_id) {
    const op = payload.resource_tag_op;
    const opName = String(op.op || op.action || '').toLowerCase();
    try {
      if (opName === 'add' || opName === 'merge') {
        storageSync.cf_tags = await mergeResourceTag(
          env,
          updated.cloudflare_image_id,
          op.key,
          op.value,
        );
      } else if (opName === 'remove' || opName === 'delete') {
        storageSync.cf_tags = await removeResourceTag(env, updated.cloudflare_image_id, op.key);
      }
      if (storageSync.cf_tags?.ok && storageSync.cf_tags.tags) {
        const nextMeta = { ...mergedMeta, cf_resource_tags: storageSync.cf_tags.tags };
        await env.DB.prepare(`UPDATE images SET metadata = ?, updated_at = unixepoch() WHERE id = ?`)
          .bind(JSON.stringify(nextMeta), updated.id)
          .run()
          .catch(() => null);
      }
    } catch (e) {
      storageSync.cf_tags = { ok: false, error: e?.message || 'resource_tag_op failed' };
    }
  }

  const accountHash = String(env.CLOUDFLARE_IMAGES_ACCOUNT_HASH || '').trim();
  const item = mapD1RowToItem(updated, { origin: url.origin, accountHash });
  if (storageSync.cf_tags?.tags) {
    item.resource_tags = storageSync.cf_tags.tags;
  } else if (meta.cf_resource_tags) {
    item.resource_tags = meta.cf_resource_tags;
  }
  return jsonResponse({
    ok: true,
    item,
    image: item,
    meta: item.meta,
    id: item.id,
    storage_sync: storageSync,
    resource_tags: item.resource_tags || null,
  });
}

export async function handleLegacyMeta(request, env, authUser, imageId) {
  const key = mediaIdToKey(imageId);
  if (!key) return jsonResponse({ error: 'Not found' }, 404);
  const binding = getR2Binding(env, BUCKET);
  if (!(await canAccessMediaObjectKey(env, authUser, key))) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }
  const payload = await request.json().catch(() => ({}));
  const tags = normalizeTags(payload?.tags);
  const sidecar = {
    ...(payload ?? {}),
    tags,
    synced_at: new Date().toISOString(),
  };
  await syncR2ImageMeta(
    env,
    key,
    {
      tags,
      meta: {
        label: payload?.label || '',
        notes: payload?.notes || '',
        category: payload?.category || '',
        project_slug: payload?.project_slug || '',
        is_live: !!payload?.is_live,
        preferred_bg: payload?.preferred_bg || '',
        tenant_slug: payload?.tenant_slug || '',
      },
      alt_text: payload?.alt_text || null,
    },
    tags,
    { userId: authUser.id, workspaceId: authUser.workspace_id || '', tenantId: authUser.tenant_id || '' },
    null,
  );
  return jsonResponse({ ok: true, meta: sidecar });
}

export async function handleLegacyD1Meta(env, authUser, identity, request, url, imageId, payload) {
  return handlePatchImage(request, url, env, authUser, identity, imageId, payload ?? {});
}

export function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function parseOpsFromQuery(searchParams) {
  const opsRaw = searchParams.get('ops');
  if (opsRaw) {
    try {
      const parsed = JSON.parse(opsRaw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // fall through to flat params
    }
  }
  const flat = {};
  for (const key of Object.keys(ALLOWED_TRANSFORM_OPS)) {
    if (searchParams.has(key)) flat[key] = searchParams.get(key);
  }
  return flat;
}

/**
 * Resolves binding-ready source bytes for an images row — R2 bytes directly (no fetch, no URL,
 * see QC-18 note in cf-images-transform.js), or the hosted CF delivery URL as a fallback.
 */

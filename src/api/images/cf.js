/** Images API: Cloudflare Images registration, variants, and tags. */

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

export async function fetchCfImageDetail(env, cfId, creds = null) {
  const accountId = String(creds?.accountId || env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(
    creds?.token || env.CLOUDFLARE_IMAGES_TOKEN || env.CLOUDFLARE_IMAGES_API_TOKEN || '',
  ).trim();
  if (!accountId || !token || !cfId) return null;
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${encodeURIComponent(cfId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) return null;
  return data.result || null;
}

export async function resolveCfImagesApiCreds(env, scope) {
  try {
    const { resolveCfImagesUploadContext } = await import('../../core/cf-oauth-images.js');
    const cfCtx = await resolveCfImagesUploadContext(env, {
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    });
    if (cfCtx?.ok && cfCtx.accountId && cfCtx.token) {
      return {
        accountId: cfCtx.accountId,
        token: cfCtx.token,
        accountHash: cfCtx.accountHash || null,
      };
    }
  } catch {
    /* platform secrets */
  }
  return {
    accountId: String(env.CLOUDFLARE_ACCOUNT_ID || '').trim(),
    token: String(env.CLOUDFLARE_IMAGES_TOKEN || env.CLOUDFLARE_IMAGES_API_TOKEN || '').trim(),
    accountHash: String(env.CLOUDFLARE_IMAGES_ACCOUNT_HASH || '').trim() || null,
  };
}

export async function registerCfImageToD1(env, scope, authUser, cfId, origin) {
  const accountHash = String(env.CLOUDFLARE_IMAGES_ACCOUNT_HASH || '').trim();
  const existing = await env.DB.prepare(
    `SELECT * FROM images
     WHERE cloudflare_image_id = ? AND user_id = ? AND workspace_id = ?
       AND COALESCE(status, 'active') = 'active'
     LIMIT 1`,
  )
    .bind(cfId, scope.userId, scope.workspaceId)
    .first()
    .catch(() => null);
  if (existing) return existing;

  const creds = await resolveCfImagesApiCreds(env, scope);
  const cfImg = await fetchCfImageDetail(env, cfId, creds);
  const cfRawMeta = cfImg?.metadata || cfImg?.meta || {};
  const parsed = parseIamMetaFromStorage(cfRawMeta);
  const imageUuid = crypto.randomUUID();
  const rowId = `img_${imageUuid.replace(/-/g, '').slice(0, 24)}`;
  const filename = safeFilename(parsed.meta.label || cfRawMeta.filename || cfRawMeta.name || cfId);
  const publicUrl = accountHash ? cfDeliveryUrl(accountHash, cfId, 'public') : '';
  const thumbUrl = accountHash ? cfDeliveryUrl(accountHash, cfId, 'thumbnail') : publicUrl;
  const uploaded = cfImg?.uploaded || cfImg?.created;
  const createdUnix = uploaded
    ? Math.floor(new Date(uploaded).getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  // CF-hosted-only: r2_key stays NULL (migration 1024). Never invent a fake R2 path.
  const r2Key = null;

  const row = {
    id: rowId,
    tenant_id: scope.tenantId,
    project_id: null,
    user_id: scope.userId,
    filename,
    original_filename: filename,
    mime_type: cfRawMeta.mime || 'image/jpeg',
    size: Number(cfImg?.size) || 0,
    width: cfImg?.width != null ? Number(cfImg.width) : null,
    height: cfImg?.height != null ? Number(cfImg.height) : null,
    r2_key: r2Key,
    cloudflare_image_id: cfId,
    url: publicUrl,
    thumbnail_url: thumbUrl,
    alt_text: parsed.alt_text,
    description: null,
    tags: JSON.stringify(parsed.tags),
    metadata: JSON.stringify({
      ...parsed.meta,
      registered_from: 'cf_live',
      origin: origin || '',
      cf_hosted_only: true,
    }),
    workspace_id: scope.workspaceId,
  };

  try {
    await env.DB.prepare(
      `INSERT INTO images (
        id, tenant_id, project_id, user_id, filename, original_filename,
        mime_type, size, width, height, r2_key, cloudflare_image_id,
        url, thumbnail_url, alt_text, description, tags, metadata, status,
        created_at, updated_at, workspace_id
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?
      )`,
    )
      .bind(
        row.id,
        row.tenant_id,
        row.project_id,
        row.user_id,
        row.filename,
        row.original_filename,
        row.mime_type,
        row.size,
        row.width,
        row.height,
        row.r2_key,
        row.cloudflare_image_id,
        row.url,
        row.thumbnail_url,
        row.alt_text,
        row.description,
        row.tags,
        row.metadata,
        'active',
        createdUnix,
        Math.floor(Date.now() / 1000),
        row.workspace_id,
      )
      .run();
  } catch (e) {
    const again = await env.DB.prepare(
      `SELECT * FROM images
       WHERE cloudflare_image_id = ? AND user_id = ?
         AND COALESCE(status, 'active') = 'active'
       LIMIT 1`,
    )
      .bind(cfId, scope.userId)
      .first()
      .catch(() => null);
    if (again) return again;
    console.warn('[images] registerCfImageToD1 insert failed', e?.message || e);
    return {
      ...row,
      created_at: createdUnix,
      updated_at: createdUnix,
      status: 'active',
      parent_image_id: null,
      transform_json: null,
      _synthetic: true,
    };
  }

  return {
    ...row,
    created_at: createdUnix,
    updated_at: Math.floor(Date.now() / 1000),
    status: 'active',
  };
}

export async function getImageRowForPatch(env, imageId, scope, authUser, origin) {
  if (String(imageId).startsWith('cf_live_')) {
    const cfId = String(imageId).slice('cf_live_'.length);
    return registerCfImageToD1(env, scope, authUser, cfId, origin);
  }
  const row = await env.DB.prepare(
    `SELECT * FROM images WHERE id = ? AND COALESCE(status, 'active') = 'active' LIMIT 1`,
  )
    .bind(imageId)
    .first();
  if (!row) return null;
  if (String(row.user_id) !== String(authUser.id)) return { forbidden: true };
  if (String(row.workspace_id) !== String(scope.workspaceId)) return { forbidden: true };
  return row;
}

/**
 * In-isolate cache for the real variants catalog — this rarely changes, and
 * refetching CF on every gallery/detail page load is wasteful. 5 min TTL is
 * a reasonable balance; a variant rename/resize in the CF dashboard will show
 * up here within that window, not instantly, which is an acceptable tradeoff.
 */
let _variantsCatalogCache = null; // { at: number, variants: Array }

export async function handleVariantsCatalog(env) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(env.CLOUDFLARE_IMAGES_TOKEN || env.CLOUDFLARE_IMAGES_API_TOKEN || '').trim();
  if (!accountId || !token) {
    return jsonResponse({ ok: true, variants: [], source: 'unconfigured' });
  }

  const now = Date.now();
  if (_variantsCatalogCache && now - _variantsCatalogCache.at < 5 * 60 * 1000) {
    return jsonResponse({ ok: true, variants: _variantsCatalogCache.variants, source: 'cache' });
  }

  try {
    const variants = await listCfImageVariants(accountId, token);
    _variantsCatalogCache = { at: now, variants };
    return jsonResponse({ ok: true, variants, source: 'live' });
  } catch (e) {
    // Serve stale cache over a hard failure if we have one, even past TTL.
    if (_variantsCatalogCache) {
      return jsonResponse({ ok: true, variants: _variantsCatalogCache.variants, source: 'stale_cache' });
    }
    return jsonResponse(
      { ok: false, variants: [], error: e?.message || 'Failed to load variants catalog' },
      502,
    );
  }
}

/** POST /api/images/variants — create account-level named variant (CF Images Write). */
export async function handleCreateVariant(request, env) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(env.CLOUDFLARE_IMAGES_TOKEN || env.CLOUDFLARE_IMAGES_API_TOKEN || '').trim();
  if (!accountId || !token) {
    return jsonResponse({ ok: false, error: 'Cloudflare Images credentials not configured' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  try {
    const variant = await createCfImageVariant(accountId, token, body || {});
    _variantsCatalogCache = null; // force catalog refresh
    return jsonResponse({ ok: true, variant });
  } catch (e) {
    if (e instanceof TransformValidationError) {
      return jsonResponse({ ok: false, error: e.message }, 400);
    }
    return jsonResponse({ ok: false, error: e?.message || 'Failed to create variant' }, 502);
  }
}

export async function handleListTags(url, env, authUser, identity) {
  const scope = await resolveScope(
    env,
    authUser,
    identity,
    url.searchParams.get('workspace_id')?.trim(),
  );
  if (scope.error) return jsonResponse({ error: scope.error }, scope.status);
  if (!env?.DB) return jsonResponse({ tags: [] });

  const { results } = await env.DB.prepare(
    `SELECT tags FROM images
     WHERE user_id = ? AND workspace_id = ? AND COALESCE(status, 'active') = 'active'
       AND tags IS NOT NULL AND trim(tags) != '' AND tags != '[]'`,
  )
    .bind(scope.userId, scope.workspaceId)
    .all()
    .catch(() => ({ results: [] }));

  const counts = new Map();
  for (const row of results || []) {
    for (const tag of parseTags(row.tags)) {
      const key = tag.toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const tags = [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  return jsonResponse({ ok: true, tags });
}

/**
 * Browse-only R2 objects (`r2obj_…`) have no D1 `images` row and no CF Images id.
 * Cloudflare Resource Tagging only covers resource_type=image (CF Images) / r2_bucket
 * (the bucket itself) — not per-object R2 files. Persist Tags via IAM customMetadata
 * + `{key}.iammeta.json` sidecar instead.
 */

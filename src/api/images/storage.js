/** Images API: storage adapters and registry persistence. */

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

export function isCfImagesUnsupportedFormat(mime, errorMessage) {
  const ct = String(mime || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (ct && !CF_IMAGES_INPUT_MIMES.has(ct)) return true;
  const msg = String(errorMessage || '').toLowerCase();
  return (
    msg.includes('content-type') ||
    msg.includes('unsupported') ||
    msg.includes('must have image/') ||
    msg.includes('invalid image')
  );
}

export function cfImagesUnsupportedPayload(mime, errorMessage) {
  const ct = String(mime || '')
    .split(';')[0]
    .trim()
    .toLowerCase() || 'unknown';
  return {
    error:
      errorMessage ||
      `Cloudflare Images does not accept ${ct} on this account. Use ${CF_IMAGES_INPUT_LABEL}, or upload to R2 instead.`,
    code: 'cf_images_unsupported',
    fallback: 'r2',
    mime: ct,
    supported: [...CF_IMAGES_INPUT_MIMES],
    hint: 'Retry with destination=r2 and r2_bucket set, or switch to the R2 tab and select a bucket.',
  };
}

export async function listR2BrowseImages(env, authUser, { bucket, prefix, origin, workspaceId }) {
  const access = await assertDashboardR2BucketAccess(env, authUser, bucket);
  if (!access.ok) {
    return { error: access.user_message || access.error || 'Forbidden', status: access.status || 403 };
  }

  const bucketName = access.bucket;
  const normPrefix = String(prefix || '').replace(/^\/+/, '');
  /** @type {{ key: string, size: number, last_modified: string|null }[]} */
  const allObjects = [];

  const binding = getR2Binding(env, bucketName);
  if (binding?.list) {
    let cursor;
    do {
      const page = await binding.list({ prefix: normPrefix, limit: 1000, cursor });
      for (const o of page.objects || []) {
        if (!o?.key || o.key.endsWith('/') || o.key.endsWith('.iammeta.json')) continue;
        if (!IMAGE_EXT.test(o.key)) continue;
        allObjects.push({
          key: o.key,
          size: o.size ?? 0,
          last_modified: o.uploaded ? new Date(o.uploaded).toISOString() : null,
        });
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor && allObjects.length < 5000);
  } else {
    // Customer / unbound buckets — list via S3 (BYOK or workspace transport), same as /api/r2/list.
    let listEnv = await mergeR2S3EnvFromUserStorage(env, authUser);
    listEnv = applyWorkspaceR2Transport(listEnv, env, access);
    const catalog = await listR2ObjectsForCatalog(listEnv, {
      bucket: bucketName,
      prefix: normPrefix,
      limit: 1000,
      recursive: true,
    });
    if (!catalog.ok) {
      return {
        error:
          catalog.user_message ||
          catalog.message ||
          catalog.error ||
          'R2 bucket not listable. Connect R2 keys in Settings → Storage, or bind the bucket.',
        status: 503,
      };
    }
    for (const o of catalog.objects || []) {
      if (!o?.key || o.key.endsWith('/') || o.key.endsWith('.iammeta.json')) continue;
      if (!IMAGE_EXT.test(o.key)) continue;
      allObjects.push({
        key: o.key,
        size: o.size ?? 0,
        last_modified: o.last_modified ?? null,
      });
    }
  }

  const items = [];
  for (const o of allObjects) {
    if (bucketName === BUCKET && !(await canAccessMediaObjectKey(env, authUser, o.key))) continue;
    items.push(mapR2BrowseObject(o, bucketName, origin, authUser.id));
  }

  items.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return { items, bucket: bucketName, prefix: normPrefix };
}

export async function listD1Images(env, { userId, workspaceId, source, tag, search, projectId, category, limit, offset }) {
  let sql = `SELECT * FROM images
    WHERE user_id = ? AND workspace_id = ? AND COALESCE(status, 'active') = 'active'`;
  const binds = [userId, workspaceId];
  if (source === 'r2') {
    sql += ` AND (cloudflare_image_id IS NULL OR cloudflare_image_id = '')`;
  } else if (source === 'cf_images') {
    sql += ` AND cloudflare_image_id IS NOT NULL AND cloudflare_image_id != ''`;
  }
  if (projectId) {
    sql += ` AND project_id = ?`;
    binds.push(String(projectId).trim());
  }
  if (category) {
    const c = String(category).trim().toLowerCase();
    sql += ` AND (
      lower(COALESCE(json_extract(metadata, '$.category'), '')) = ?
      OR lower(COALESCE(tags, '')) LIKE ?
    )`;
    binds.push(c, `%"${c}"%`);
  }
  if (tag) {
    sql += ` AND (
      lower(tags) LIKE ? OR lower(tags) LIKE ? OR lower(tags) LIKE ? OR lower(tags) = ?
    )`;
    const t = String(tag).trim().toLowerCase();
    binds.push(`%"${t}"%`, `%"${t}"`, `%${t},%`, `["${t}"]`);
  }
  if (search) {
    const q = `%${String(search).trim().toLowerCase()}%`;
    sql += ` AND (
      lower(COALESCE(filename, '')) LIKE ? OR lower(COALESCE(original_filename, '')) LIKE ?
      OR lower(COALESCE(alt_text, '')) LIKE ? OR lower(COALESCE(description, '')) LIKE ?
      OR lower(COALESCE(tags, '')) LIKE ? OR lower(COALESCE(metadata, '')) LIKE ?
    )`;
    binds.push(q, q, q, q, q, q);
  }
  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  binds.push(limit, offset);
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return results || [];
}

export async function listAllCfImagesLive(env, authUserId, knownCfIds) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(env.CLOUDFLARE_IMAGES_TOKEN || env.CLOUDFLARE_IMAGES_API_TOKEN || '').trim();
  const accountHash = String(env.CLOUDFLARE_IMAGES_ACCOUNT_HASH || '').trim();
  if (!accountId || !token || !accountHash) return { items: [], accountHash: '' };

  const known = knownCfIds || new Set();
  const items = [];
  let continuationToken = null;
  let pages = 0;
  const MAX_PAGES = 64;

  const mapBatch = (images) => {
    for (const img of images || []) {
      if (!img?.id || known.has(img.id)) continue;
      const mapped = mapCfApiImage(img, accountHash, authUserId);
      if (mapped) items.push(mapped);
    }
  };

  // Prefer V2 — up to 1000 per page + continuation_token (full account catalog).
  do {
    const qs = new URLSearchParams({ per_page: '1000', sort_order: 'desc' });
    if (continuationToken) qs.set('continuation_token', continuationToken);
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v2?${qs}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.success) {
      const result = data.result || {};
      mapBatch(result.images);
      continuationToken = result.continuation_token || null;
      pages += 1;
      if (!continuationToken) break;
      continue;
    }
    // Fallback to V1 page index when V2 is unavailable.
    continuationToken = null;
    break;
  } while (continuationToken && pages < MAX_PAGES);

  if (items.length === 0 && pages === 0) {
    let page = 1;
    while (page <= MAX_PAGES) {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1?page=${page}&per_page=100`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) break;
      const batch = data.result?.images || data.result || [];
      if (!Array.isArray(batch) || batch.length === 0) break;
      mapBatch(batch);
      if (batch.length < 100) break;
      page += 1;
    }
  }

  return { items, accountHash };
}

export async function driveAccountSummary(env, userId) {
  try {
    const { getIntegrationOAuthRow } = await import('../../../backend/identity/oauth/user-token.js');
    const row = await getIntegrationOAuthRow(env, userId, 'google_drive', '');
    if (!row) return { connected: false, account_email: null };
    return {
      connected: true,
      account_email: String(row.account_email || row.account_display || '').trim() || null,
      expires_at: row.expires_at != null ? Number(row.expires_at) : null,
      has_refresh: !!(row.refresh_token || row.vault_refresh_token_id || row.refresh_token_encrypted),
    };
  } catch {
    return { connected: false, account_email: null };
  }
}

export async function listDriveImages(env, userId, origin) {
  const acct = await driveAccountSummary(env, userId);
  const token = await getOAuthToken(env, userId, 'google_drive');
  if (!token) return { items: [], ...acct, connected: false };

  const q = encodeURIComponent("mimeType contains 'image/' and trashed = false");
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size,createdTime,thumbnailLink,webViewLink,webContentLink)&pageSize=100&orderBy=createdTime desc`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      items: [],
      connected: true,
      account_email: acct.account_email,
      expires_at: acct.expires_at,
      has_refresh: acct.has_refresh,
      error: data.error?.message || res.statusText,
    };
  }
  const items = (data.files || []).map((f) => mapDriveFile(f, userId, origin));
  return {
    items,
    connected: true,
    account_email: acct.account_email,
    expires_at: acct.expires_at,
    has_refresh: acct.has_refresh,
  };
}

export async function handleDriveMedia(env, authUser, fileId, variant) {
  const id = String(fileId || '').trim();
  if (!id) return jsonResponse({ error: 'file_id required' }, 400);

  const token = await getOAuthToken(env, authUser.id, 'google_drive');
  if (!token) return jsonResponse({ error: 'Google Drive not connected' }, 400);

  const authHeaders = { Authorization: `Bearer ${token}` };

  if (variant === 'thumbnail') {
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=thumbnailLink,mimeType`,
      { headers: authHeaders },
    );
    const meta = await metaRes.json().catch(() => ({}));
    if (metaRes.ok && meta.thumbnailLink) {
      const thumbRes = await fetch(String(meta.thumbnailLink), { headers: authHeaders });
      if (thumbRes.ok && thumbRes.body) {
        return new Response(thumbRes.body, {
          headers: {
            'Content-Type': thumbRes.headers.get('Content-Type') || 'image/jpeg',
            'Cache-Control': 'private, max-age=3600',
          },
        });
      }
    }
  }

  const mediaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`,
    { headers: authHeaders },
  );
  if (!mediaRes.ok || !mediaRes.body) {
    const err = await mediaRes.json().catch(() => ({}));
    return jsonResponse(
      { error: err.error?.message || 'Drive media unavailable' },
      mediaRes.status >= 400 ? mediaRes.status : 502,
    );
  }

  return new Response(mediaRes.body, {
    headers: {
      'Content-Type': mediaRes.headers.get('Content-Type') || 'application/octet-stream',
      'Cache-Control': 'private, max-age=300',
    },
  });
}

export async function uploadToCfImages(env, file, metadata, creds = null) {
  const accountId = String(creds?.accountId || env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(
    creds?.token || env.CLOUDFLARE_IMAGES_TOKEN || env.CLOUDFLARE_IMAGES_API_TOKEN || '',
  ).trim();
  if (!accountId || !token) {
    return { error: 'Cloudflare Images not configured', status: 503 };
  }
  const form = new FormData();
  form.append('file', file, file.name || 'upload.jpg');
  form.append('requireSignedURLs', 'false');
  form.append('metadata', JSON.stringify(metadata));

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.success) {
    const msg = json?.errors?.[0]?.message || json?.messages?.[0]?.message || 'CF Images upload failed';
    return { error: msg, status: res.status >= 400 ? res.status : 502 };
  }
  const imageId = json?.result?.id;
  if (!imageId) return { error: 'No image id from Cloudflare', status: 502 };
  return {
    imageId,
    variants: json?.result?.variants || [],
    uploaded: json?.result?.uploaded,
    iam_hosted: creds?.iam_hosted === true,
    cf_account_id: accountId,
  };
}

export async function patchCfImageMeta(env, cfImageId, metaPayload) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(env.CLOUDFLARE_IMAGES_TOKEN || env.CLOUDFLARE_IMAGES_API_TOKEN || '').trim();
  if (!accountId || !token || !cfImageId) {
    return { ok: false, error: 'Cloudflare Images not configured' };
  }
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${encodeURIComponent(cfImageId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ metadata: metaPayload, meta: metaPayload }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    const msg = data?.errors?.[0]?.message || data?.messages?.[0]?.message || 'CF Images meta PATCH failed';
    return { ok: false, error: msg, status: res.status };
  }
  return { ok: true, result: data.result };
}

export async function writeR2MetaSidecar(binding, r2Key, payload) {
  if (!binding?.put || !r2Key) return;
  await binding.put(metaSidecarKey(r2Key), JSON.stringify(payload ?? {}), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
}

export async function syncR2ImageMeta(env, r2Key, sidecarPayload, tags, scope, sizeBytes, bucketName = BUCKET) {
  const bucket = String(bucketName || BUCKET).trim() || BUCKET;
  const binding = getR2Binding(env, bucket);
  if (!r2Key) return { ok: false, error: 'R2 key required' };

  // Prefer Worker binding; fall back to S3 put for sidecar when unbound.
  if (binding?.put) {
    await writeR2MetaSidecar(binding, r2Key, sidecarPayload);
    const sync = await syncR2ObjectCustomMetadata(binding, r2Key, {
      tags,
      meta: sidecarPayload.meta,
      scope,
      alt_text: sidecarPayload.alt_text,
      description: sidecarPayload.description,
      sizeBytes,
      maxBytes: MAX_BYTES,
    });
    return {
      ok: sync.ok,
      customMetadata: sync.customMetadata,
      sidecar_only: !sync.object_updated,
      bucket,
      store: 'iam_custom_metadata',
    };
  }

  const sidecarOk = await r2PutViaBindingOrS3(
    env,
    null,
    bucket,
    metaSidecarKey(r2Key),
    JSON.stringify(sidecarPayload ?? {}),
    'application/json; charset=utf-8',
  );
  return {
    ok: !!sidecarOk,
    customMetadata: null,
    sidecar_only: true,
    bucket,
    store: 'iam_sidecar',
    error: sidecarOk ? undefined : 'R2 not configured for bucket',
  };
}

export async function syncImageStorageMeta(env, row, scope, { tags, meta, alt_text, resource_tags }) {
  const tagList = normalizeTags(tags ?? parseTags(row.tags));
  const metaFields = meta || buildMetaFromRow(row);
  const alt = alt_text ?? row.alt_text ?? null;
  const sync = { cf: null, r2: null, cf_tags: null };

  if (row.cloudflare_image_id) {
    const cfPayload = buildCfImagesMetaPayload({
      tags: tagList,
      meta: metaFields,
      scope,
      alt_text: alt,
      filename: row.filename,
    });
    sync.cf = await patchCfImageMeta(env, row.cloudflare_image_id, cfPayload);
  }

  if (row.r2_key) {
    const rowMeta = parseMetadata(row.metadata);
    const r2Bucket =
      String(rowMeta.r2_bucket || rowMeta.bucket || '').trim() || BUCKET;
    const sidecar = buildR2SidecarPayload({
      tags: tagList,
      meta: metaFields,
      alt_text: alt,
      scope,
      resource_tags:
        resource_tags && typeof resource_tags === 'object' ? resource_tags : undefined,
    });
    sync.r2 = await syncR2ImageMeta(env, row.r2_key, sidecar, tagList, scope, row.size, r2Bucket);
  }

  // Cloudflare Resource Tagging (account-level, resource_type=image) — best-effort beta sync.
  const cfImageId = String(row.cloudflare_image_id || '').trim();
  if (cfImageId && resource_tags !== undefined) {
    try {
      sync.cf_tags = await syncImageResourceTags(env, cfImageId, resource_tags || {});
    } catch (e) {
      sync.cf_tags = { ok: false, error: e?.message || 'cf_tags sync failed' };
    }
  }

  return sync;
}

export async function deleteCfImage(env, cfImageId) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(env.CLOUDFLARE_IMAGES_TOKEN || env.CLOUDFLARE_IMAGES_API_TOKEN || '').trim();
  if (!accountId || !token || !cfImageId) return;
  await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${encodeURIComponent(cfImageId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  ).catch(() => {});
}

export async function insertImageRow(env, row) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO images (
      id, tenant_id, project_id, user_id, filename, original_filename,
      mime_type, size, width, height, r2_key, cloudflare_image_id,
      url, thumbnail_url, alt_text, description, tags, metadata, status,
      created_at, updated_at, workspace_id, parent_image_id, transform_json
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?
    )`,
  )
    .bind(
      row.id,
      row.tenant_id,
      row.project_id || null,
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
      now,
      now,
      row.workspace_id,
      row.parent_image_id || null,
      row.transform_json || null,
    )
    .run();
  return { ...row, created_at: now, updated_at: now, parent_image_id: row.parent_image_id || null, transform_json: row.transform_json || null };
}
